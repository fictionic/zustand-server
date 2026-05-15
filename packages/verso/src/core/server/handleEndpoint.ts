import type {StandardizedEndpoint} from "../common/handler/Endpoint";
import {cancelAbortTimeout, getAbortPromise, getAbortSignal} from "../common/abort";
import type {HandlerResponse} from "./response";

export function handleEndpoint(endpoint: StandardizedEndpoint): HandlerResponse {
  const { readable, writable } = new TransformStream();
  Promise.race([
    Promise.resolve().then(() => endpoint.getResponseData()),
    // ^guard against synchronous throws in getResponseData
    getAbortPromise(),
  ])
    .then(async (data) => {
      const body = new Response(data).body;
      if (body) {
        await body.pipeTo(writable, { signal: getAbortSignal() });
      } else {
        await writable.close();
      }
    })
    .catch((error) => {
      console.error("[verso] unexpected error writing response", error);
      writable.abort();
    })
    .finally(() => {
      cancelAbortTimeout();
    });
  return {
    getContentType: () => endpoint.getContentType(),
    getBody: () => readable,
  };
}
