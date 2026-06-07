import type {ReactElement} from 'react';
import {TOKEN, tokenizeElements, type PageElementToken} from '../common/tokenizeElements';
import {scheduleRootRender} from './components/Root';
import type {MaybePromise} from '../../util/promise';
import type {RenderableHTMLAttributes} from './components/attrs';
import {getAbortPromise} from './abort';

const TOKEN_STATUS = {
  PENDING: 'PENDING',
  RENDERED: 'RENDERED',
  PROCESSED: 'PROCESSED',
  ABORTED: 'ABORTED',
} as const;

type ProcessableToken<T> = {
  token: PageElementToken;
  status: typeof TOKEN_STATUS[keyof typeof TOKEN_STATUS];
  rendered: T | null;
};

export type ProcessorOpts<RenderedElement> = {
  renderContainerOpen: (index: number, attrs: RenderableHTMLAttributes) => RenderedElement,
  renderContainerClose: (index: number) => RenderedElement,
  renderRootElement: (index: number, element: ReactElement, attrs: RenderableHTMLAttributes) => RenderedElement,
  onLastProcessedRootIndex?: (index: number) => void,
  onProcessedTheFoldIndex?: (index: number) => MaybePromise<void>,
  consumeRenderedElements: (renderedElements: RenderedElement[]) => void,
};

/**
 * The algorithm for processing Page.getElements().
 * Server-side, used for streaming SSR.
 * Client-side, used for SPA transitions.
 *
 * The basic flow is:
 * - walk through the tokens in order, and kick off scheduleRootRender on each Root right away
 * - start a cursor at the front of the token list. each time a Root promise resolves, process
 *   all elements from the cursor up to the last element that's ready (where 'process' might mean
 *   either writing HTML to the response stream, or mounting React elements in the DOM), and move
 *   the cursor to the last element processed.
 *
 * This ensures that all elements are processed in order (a core Verso principle), while getting
 * them out the door as soon as possible.
 *
 * Adapted from the writeBody algorithm in react-server's renderMiddleware.js.
 */
export class PageElementProcessor<RenderedElement> {
  private cursor: Cursor<RenderedElement>;
  private walking: boolean;
  private buffer: RenderedElement[];
  private lastProcessedRootIndex: number | null;
  private processedTheFoldIndex: number | null;

  constructor(private opts: ProcessorOpts<RenderedElement>) {
    this.cursor = new Cursor();
    this.walking = false;
    this.buffer = [];
    this.lastProcessedRootIndex = null;
    this.processedTheFoldIndex = null;
  }

  async process(elements: ReactElement[]): Promise<void> {
    const tokens = tokenizeElements(elements);

    const rootPromises: Promise<unknown>[] = [];

    tokens.forEach((token, i) => {
      const processable: ProcessableToken<RenderedElement> = {
        token,
        status: TOKEN_STATUS.PENDING,
        rendered: null,
      };
      switch (token.type) {
        case TOKEN.CONTAINER_OPEN: {
          processable.status = TOKEN_STATUS.RENDERED;
          const { children: _children, ...attrs } = token.element.props;
          processable.rendered = this.opts.renderContainerOpen(i, attrs);
          break;
        }
        case TOKEN.CONTAINER_CLOSE:
          processable.status = TOKEN_STATUS.RENDERED;
          processable.rendered = this.opts.renderContainerClose(i);
          break;
        case TOKEN.THE_FOLD:
          processable.status = TOKEN_STATUS.RENDERED;
          // the fold is just a control element; nothing to render
          break;
        case TOKEN.ROOT: {
          const { promise, attrs } = scheduleRootRender(token.element);
          const renderPromise = promise.then(async (reactElement) => {
            if (processable.status === TOKEN_STATUS.ABORTED) return;
            processable.rendered = this.opts.renderRootElement(i, reactElement, attrs);
            processable.status = TOKEN_STATUS.RENDERED;
            await this.walk();
          });
          rootPromises.push(renderPromise);
          break;
        }
        default:
          token satisfies never;
      }
      this.cursor.push(processable);
    });

    await this.walk();

    await Promise.race([
      Promise.all(rootPromises),
      getAbortPromise().catch(() => {
        // we mark all pending roots as failed, process what's left,
        // and return control to the caller
        this.cursor.abortPending();
      }),
    ]);

    await this.walk();
  }

  private async walk() {
    if (this.walking) return;
    try {
      this.walking = true;
      let blocked = false;
      while (this.cursor.hasMore()) {
        if (blocked) break;
        const [processable, i] = this.cursor.peek()
        switch (processable.status) {
          case TOKEN_STATUS.PENDING:
            // have to go in order. we're blocked until the next one is ready
            blocked = true;
            continue; // with the above, exits the loop
          case TOKEN_STATUS.PROCESSED:
            // this shouldn't happen. runtime invariant.
            console.error("[verso] elements rendering out of order! (?)");
            break;
          case TOKEN_STATUS.ABORTED:
            // nothing to do. just keep moving
            break;
          case TOKEN_STATUS.RENDERED: {
            // got one!
            if (processable.token.type === TOKEN.THE_FOLD) {
              processable.status = TOKEN_STATUS.PROCESSED;
              this.processedTheFoldIndex = i;
              await this.flush(); // notify about the fold right away
            } else {
              const value = processable.rendered ?? null;
              if (value !== null) {
                this.buffer.push(value);
                processable.status = TOKEN_STATUS.PROCESSED;
                processable.rendered = null; // GC
                if (processable.token.type === TOKEN.ROOT) {
                  this.lastProcessedRootIndex = i;
                }
              }
            }
            break;
          }
          default:
            processable.status satisfies never;
            break;
        }
        this.cursor.step();
      }
      await this.flush();
    } finally {
      this.walking = false;
    }
  }

  private async flush() {
    if (this.buffer.length) {
      this.opts.consumeRenderedElements(this.buffer);
      this.buffer.splice(0, this.buffer.length);
    }
    if (this.lastProcessedRootIndex !== null) {
      this.opts.onLastProcessedRootIndex?.(this.lastProcessedRootIndex);
      this.lastProcessedRootIndex = null;
    }
    if (this.processedTheFoldIndex !== null) {
      await this.opts.onProcessedTheFoldIndex?.(this.processedTheFoldIndex);
      this.processedTheFoldIndex = null;
    }
  }

}

class Cursor<T> {
  private index: number;
  private array: Array<ProcessableToken<T>>;

  constructor() {
    this.index = 0;
    this.array = [];
  }

  push(t: ProcessableToken<T>) {
    this.array.push(t);
  }

  peek(): [ProcessableToken<T>, number] {
    return [this.array[this.index]!, this.index];
  }

  hasMore() {
    return this.index < this.array.length;
  }

  step() {
    this.index++;
  }

  abortPending() {
    for (let i = this.index; i < this.array.length; i++) {
      const t = this.array[i]!;
      if (t.status === TOKEN_STATUS.PENDING) {
        t.status = TOKEN_STATUS.ABORTED;
      }
    }
  }
}

