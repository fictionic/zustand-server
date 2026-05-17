import {Fetch} from "../common/fetch/Fetch";
import {FETCH_CACHE_KEY, FN_ABORT_HYDRATION, FN_HYDRATE_ROOTS_UP_TO, FN_RECEIVE_LATE_DATA_ARRIVAL, FN_SIGNAL_ROOTS_COMPLETE, REQUEST_METHOD_KEY, VersoPipe} from "../common/VersoPipe";
import {getScriptAttrs, type Script, type StandardizedPage} from "../common/handler/Page";
import {renderOpenTag, writeHeader} from "./writeHeader";
import {renderContainerOpen, renderContainerClose} from '../common/components/RootContainer';
import type {CacheableRequest, CacheEntryData} from "../common/fetch/cache";
import type {HandlerResponse} from "./response";
import {cancelAbortTimeout, didAbort} from "../common/abort";
import {getStash} from "./stash";
import {PageElementProcessor} from "../common/PageElementProcessor";
import {renderToString} from "react-dom/server";
import {renderRootToString} from "../common/components/Root";

export function handlePage(page: StandardizedPage): HandlerResponse {
  const { readable, writable } = new TransformStream<Uint8Array>();

  const writer = writable.getWriter();
  const { write, flush, close } = buffered(writer);

  // for transporting data to the client over the http response
  const writeablePipe = VersoPipe.writer(write);

  // for waiting until all server-side api calls resolve, even ones that don't block render
  const lateArrivalsDfd = Promise.withResolvers<void>();

  async function writePage() {
    write(`<!DOCTYPE html><html lang="en"><head>`);
    await writeHeader(page, write);
    write(`</head>`);
    flush(); // initiate preloads asap

    // this is where the fun begins...
    write(await renderBodyOpen());

    let haveBootstrapped = false;

    let lastRootIndex = 0;
    function onRoot(index: number) {
      if (haveBootstrapped) {
        hydrateRootsUpTo(index);
        flush();
      }
      lastRootIndex = index;
    };

    async function onTheFold(index: number) {
      if (haveBootstrapped) {
        console.warn(`writePage: unexpected additional TheFold at index ${index}`);
        return;
      }
      await bootstrapClient(index);
      lateArrivalsDfd.resolve(setupLateArrivals());
      haveBootstrapped = true;
    };

    const processor = new PageElementProcessor<string>({
      renderContainerOpen,
      renderContainerClose,
      renderRootElement: (element, i) => {
        let rootInnerHTML;
        try {
          rootInnerHTML = renderToString(element);
        } catch (err) {
          console.error(`[writeBody] renderToString failed for element ${i}; rendering empty div`, err);
          // we can't bail out the response; we've already sent the status code.
          // we could opt to just render nothing; but then the client wouldn't be able to hydrate into anything.
          // it's maybe better to give the client _something_ to hydrate into, in case the render failure was
          // caused by an error that only happens in the server. react will complain about the mismatch but the
          // root should still be functional. or if the error happens in the client too, it will be more
          // discoverable in the browser console
          rootInnerHTML = '';
        }
        return renderRootToString(i, rootInnerHTML);
      },
      onLastProcessedRootIndex: onRoot,
      onProcessedTheFoldIndex: onTheFold,
      consumeRenderedElements: (rendered) => {
        rendered.forEach(write);
      },
    });

    await processor.process(page.getElements());

    signalRootsComplete();

    if (!haveBootstrapped) {
      // if TheFold wasn't declared, then it's after the last root
      await onTheFold(lastRootIndex + 1);
    }

    if (didAbort()) {
      abortHydration();
      flush();
    }

    await wrapUpLateArrivals();
    write('</body></html>');
    close();
  }

  async function renderBodyOpen() {
    const bodyClasses = await page.getBodyClasses();
    const bodyAttrs = bodyClasses.length ? ` class="${bodyClasses.join(' ')}"` : '';
    return `<body${bodyAttrs}>`;
  }

  function hydrateRootsUpTo(index: number) {
    writeablePipe.callFn(FN_HYDRATE_ROOTS_UP_TO, [index]);
  }

  async function bootstrapClient(theFoldIndex: number) {
    const fetchCache = Fetch.getCache().server().dehydrate();
    writeablePipe.writeValue(FETCH_CACHE_KEY, fetchCache);
    const method = getStash().request.method;
    writeablePipe.writeValue(REQUEST_METHOD_KEY, method);
    for (const script of [...await page.getSystemScripts(), ...page.getScripts()]) {
      write(renderScript(script));
    }
    hydrateRootsUpTo(theFoldIndex - 1);
    flush();
  }

  async function setupLateArrivals(): Promise<void> {
    const pending = Fetch.getCache().server().getPending();
    if (pending.length === 0) return Promise.resolve();
    await Promise.allSettled(
      pending.map(async ({ request, dataPromise }) => {
        const data = await dataPromise;
        receiveLateArrival(request, data);
        flush();
      })
    );
  }

  function signalRootsComplete() {
    writeablePipe.callFn(FN_SIGNAL_ROOTS_COMPLETE, []);
  }

  function receiveLateArrival(request: CacheableRequest, data: CacheEntryData) {
    writeablePipe.callFn(FN_RECEIVE_LATE_DATA_ARRIVAL, [request, data]);
  }

  function wrapUpLateArrivals() {
    // we don't have to race against the abort promise here because
    // our fetch() calls are automatically wired up to the abort signal
    return lateArrivalsDfd.promise;
  }

  function abortHydration() {
    writeablePipe.callFn(FN_ABORT_HYDRATION, []);
  }


  writePage().catch((err) => {
    console.error("[verso] unexpected error writing page", err);
  }).then(() => {
    close();
    cancelAbortTimeout();
  });

  return {
   getContentType: () => 'text/html; charset=utf-8',
   getBody: () => readable,
  };
};

function renderScript(script: Script): string {
  const text = 'text' in script ? script.text : '';
  return `${renderOpenTag('script', getScriptAttrs(script))}${text}</script>\n`;
}

const encoder = new TextEncoder();

function buffered(writer: WritableStreamDefaultWriter) {
  let writeBuffer = '';
  let closed = false; // guard against write-after-close
  function write(chunk: string) {
    if (closed) return;
    writeBuffer += chunk;
  }
  function flush() {
    if (closed) return;
    if (writeBuffer.length === 0) return;
    writer.write(encoder.encode(writeBuffer));
    writeBuffer = '';
  }
  function close() {
    if (closed) return;
    flush()
    closed = true;
    writer.close();
  }
  return { write, flush, close };
}

