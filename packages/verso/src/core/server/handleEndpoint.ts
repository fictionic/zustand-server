import type {StandardizedEndpoint} from "../common/handler/Endpoint";
import type {HandlerResponse} from "./response";

export function handleEndpoint(endpoint: StandardizedEndpoint): HandlerResponse {
  const { readable, writable } = new TransformStream();
  (async () => {
    try {
      const data = await endpoint.getResponseData();
      const source = new Response(data).body;
      if (source) {
        await source.pipeTo(writable);
      } else {
        await writable.close();
      }
    } catch (err) {
      console.error("[verso] unexpected error writing response", err);
      await writable.abort(err).catch(() => {});
    }
  })();
  return {
    getContentType: () => endpoint.getContentType(),
    getBody: () => readable,
  };
}
