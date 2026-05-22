import {getServerStash} from "../server/stash";
import {getAbortSignal} from "./abort";
import {isServer} from "./env";

/**
 * Represents a request to the Verso server which can be replayed clientside.
 */
export class VersoRequest implements Body {
  readonly bodyUsed = false;

  constructor(private req: Request) {}

  /**
   * Note that this does not include the url hash, as it is not sent to the server.
   * If you need the hash, use window.location.hash.
   */
  get url(): string { return this.req.url };

  /**
   * The HTTP method of the request.
   */
  get method(): string { return this.req.method };

  /**
   * The HTTP body of the request.
   */
  get body(): ReadableStream<Uint8Array<ArrayBuffer>> | null { return this.req.body };

  /**
   * Body consumers. These each clone the underlying request, so the body is never consumed.
   */
  arrayBuffer(): Promise<ArrayBuffer> { return this.clonedReq().arrayBuffer() };
  blob(): Promise<Blob> { return this.clonedReq().blob() };
  bytes(): Promise<Uint8Array<ArrayBuffer>> { return this.clonedReq().bytes() };
  formData(): Promise<FormData> { return this.clonedReq().formData() };
  json(): Promise<any> { return this.clonedReq().json() };
  text(): Promise<string> { return this.clonedReq().text() };

  /**
   * Abort signal for the Verso request. Will abort on timeout server-side,
   * and on interrupted navigation client-side.
   *
   * This is automatically passed into Verso fetch() calls. It should only
   * be necessary for other abortable work.
   */
  get signal(): AbortSignal {
    return getAbortSignal();
  }

  /**
   * Convenience getter for URL query params.
   */
  getQuery(): URLSearchParams {
    return new URL(this.req.url).searchParams;
  }

  /**
   * Server-side: returns a clone of the raw Request object received by the server.
   * Contains HTTP headers, which might not be trustworthy (e.g. Host header injection).
   * Use with care.
   *
   * Client-side: returns null.
   */
  getRawServerRequest(): Request | null {
    return isServer() ? getServerStash().rawRequest.clone() : null;
  }

  private clonedReq() {
    return this.req.clone();
  }
}

