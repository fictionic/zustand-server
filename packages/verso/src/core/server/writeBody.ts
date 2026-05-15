import { renderToString } from 'react-dom/server';
import { scheduleRender } from '../common/components/Root';
import {TOKEN, tokenizeElements, type PageElementToken} from '../common/tokenizeElements';
import {renderContainerOpen, renderContainerClose} from '../common/components/RootContainer';
import {PAGE_ELEMENT_TOKEN_ID_ATTR, PAGE_ROOT_ELEMENT_ATTR} from '../common/constants';
import type {StandardizedPage} from '../common/handler/Page';
import {getAbortPromise} from '../common/abort';

const TOKEN_STATUS = {
  PENDING: 'PENDING',
  RENDERED: 'RENDERED',
  TIMEOUT: 'TIMEOUT',
  WRITTEN: 'WRITTEN',
} as const;

type RenderedToken = {
  token: PageElementToken;
  status: typeof TOKEN_STATUS[keyof typeof TOKEN_STATUS];
  html: string | null;
};

export async function writeBody(
  page: StandardizedPage,
  write: (html: string) => void,
  onRoot: (index: number) => void,
  onTheFold: (index: number) => Promise<void>,
) {
  const elements = page.getElements();
  const tokens = tokenizeElements(elements);
  const queue: RenderedTokenQueue = new RenderedTokenQueue();

  const rootPromises: Promise<unknown>[] = [];

  tokens.forEach((token, i) => {
    const rendered: RenderedToken = {
      token,
      status: TOKEN_STATUS.PENDING,
      html: null,
    };
    switch (token.type) {
      case TOKEN.CONTAINER_OPEN:
        rendered.status = TOKEN_STATUS.RENDERED;
        rendered.html = renderContainerOpen(token.element, i);
        break;
      case TOKEN.CONTAINER_CLOSE:
        rendered.status = TOKEN_STATUS.RENDERED;
        rendered.html = renderContainerClose();
        break;
      case TOKEN.THE_FOLD:
        rendered.status = TOKEN_STATUS.RENDERED;
        // the fold is just a control element; nothing to render
        break;
      case TOKEN.ROOT:
        rootPromises.push(scheduleRender(token.element).then((resolved) => {
          if (rendered.status === TOKEN_STATUS.TIMEOUT) return;
          let rootInnerHTML;
          try {
            rootInnerHTML = renderToString(resolved);
          } catch (err) {
            console.error(`[renderBody] renderToString failed for element ${i}; rendering empty div`, err);
            // we can't bail out the response; we've already sent the 200.
            // we could opt to just render nothing; then the client wouldn't be able to hydrate into anything.
            // but it's maybe better to give the client _something_ to hydrate into, in case the render failure
            // was caused by an error that only happens in the server. react will complain about the mismatch but
            // the root should still be functional. or if the error happens in the client too, it will be more
            // discoverable in the browser console
            rootInnerHTML = '';
          }
          rendered.html = `<div ${PAGE_ELEMENT_TOKEN_ID_ATTR}="${i}" ${PAGE_ROOT_ELEMENT_ATTR}>${rootInnerHTML}</div>\n`;
          // TODO: move this rendering^ into Root.tsx?
          rendered.status = TOKEN_STATUS.RENDERED;
          writeRenderedTokens();
        }));
        break;
      default:
        token satisfies never;
    }
    queue.add(rendered);
  });

  writeRenderedTokens(); // render any synchronous control elements right away

  async function writeRenderedTokens() {
    let buffer = ''
    let foundRoot = false;
    while(queue.hasNext()) {
      let [i, renderedToken] = queue.current()
      if (renderedToken.status === TOKEN_STATUS.PENDING) {
        // have to go in order. we're blocked until the next one is ready
        break;
      } else {
        if (renderedToken.status === TOKEN_STATUS.WRITTEN) {
          // this shouldn't happen. runtime invariant.
          console.error("[verso] elements rendering out of order! (?)");
        } else if (renderedToken.status === TOKEN_STATUS.TIMEOUT) {
          // nothing to render. just keep moving
        } else if (renderedToken.status === TOKEN_STATUS.RENDERED) {
          // got one!
          if (renderedToken.token.type === TOKEN.THE_FOLD) {
            await onTheFold(i); // bootstrap the client
            renderedToken.status = TOKEN_STATUS.WRITTEN;
          }
          if (renderedToken.html) {
            buffer += renderedToken.html;
            renderedToken.status = TOKEN_STATUS.WRITTEN;
            renderedToken.html = null; // GC
            if (renderedToken.token.type === TOKEN.ROOT) {
              foundRoot = true;
            }
          }
        } else {
          renderedToken.status satisfies never;
        }
        queue.consume();
      }
    }
    if (buffer.length > 0) {
      write(buffer);
      if (foundRoot) {
        // wake all roots up to the last one we wrote
        // (ok to overshoot; client skips non-roots)
        onRoot(queue.lastConsumedIndex());
      }
    }
  };

  await Promise.race([
    Promise.all(rootPromises),
    getAbortPromise().catch(() => {
      // if we take too long, we mark all pending roots as failed,
      // write them out, and return control to the caller
      queue.abort();
      return writeRenderedTokens();
    }),
  ]);
}


class RenderedTokenQueue {
  private index: number;
  private array: Array<RenderedToken>;

  constructor() {
    this.index = 0;
    this.array = [];
  }

  add(t: RenderedToken) {
    this.array.push(t);
  }

  current(): [number, RenderedToken] {
    return [this.index, this.array[this.index]!];
  }

  hasNext() {
    return this.index < this.array.length;
  }

  consume() {
    this.index++;
  }

  lastConsumedIndex() {
    return this.index - 1;
  }

  abort() {
    for (let i = this.index; i < this.array.length; i++) {
      const t = this.array[i]!;
      if (t.status === TOKEN_STATUS.PENDING) {
        t.status = TOKEN_STATUS.TIMEOUT;
      }
    }
  }
}
