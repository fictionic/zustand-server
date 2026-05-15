import type {ParamData} from "path-to-regexp";

export class VersoRequest {
  private url: URL;
  private method: string;
  private routeParams: ParamData;

  constructor(url: URL, method: string, params: ParamData) {
    this.url = url;
    this.method = method;
    this.routeParams = params;
  }

  getParams() {
    return this.routeParams;
  }

  getURL() {
    // TODO: note somewhere that this is not isomorphic because location.hash isn't sent to the server
    // (or just strip out the hash on the client?)
    return this.url;
  }

  getPath() {
    return this.url.pathname;
  }

  getQuery() {
    return this.url.searchParams;
  }

  getMethod() {
    return this.method;
  }
}

