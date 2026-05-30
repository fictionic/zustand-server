import type {ServerSettings} from "../../build/config";
import type {RequestHandler} from "../../vendor/hattip/compose";

export function handleFailsafeTimeouts(settings: ServerSettings): RequestHandler {
  const { responseStartTimeout: routerTimeout, responseEndTimeout: responseTimeout } = settings;
  return (ctx) => {
    const req = ctx.request;

    const upstreamSignal = req.signal;

    // abort if the response body takes too long to finish streaming.
    // merge upstream abort signal with a timeout signal.
    const mergedSignal = AbortSignal.any([
      upstreamSignal,
      AbortSignal.timeout(responseTimeout),
    ]);
    ctx.request = new Request(req, {
      signal: mergedSignal,
    });

    // prevent writing to the response stream if the upstream signal has aborted.
    // (the abort signal from upstream is tripped by verso runtime adapters when there's a client disconnect)
    const guardedRes = ctx.next().then((res) => {
      if (!res.body) return res;
      const ts = new TransformStream();
      res.body.pipeTo(ts.writable, {
        signal: upstreamSignal,
        preventCancel: true, // don't close the writable; let it listen to the signal and abort on its own.
        // (handlePage continues to write to the response for a little bit, to signal abort to the client.
        // streaming Endpoint handlers are responsible for observing the abort signal and stopping their work.
        // otherwise they'll write wasted work into the ether.)
      }).catch(() => {
        // expected on abort or downstream cancel
      });
      return new Response(ts.readable, res);
    });

    // short-circuit a 504 response if the response takes too long to begin streaming (ttfb)
    return Promise.race([
      guardedRes,
      new Promise<Response>((resolve) => {
        setTimeout(() => {
          resolve(new Response('Failsafe timeout', {
            status: 504,
          }));
        }, routerTimeout);
      }),
    ]);
  };
}
