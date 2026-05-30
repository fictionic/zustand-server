import type {HandleRequest} from "../../core/server/handleRequest";
import type {ServerAssets} from "../bundle";
import type {ServerEntry} from "../entrypoint";

export interface RuntimeAdapter {
  loadAssets(): Promise<ServerAssets>;
  loadServerEntry(): Promise<ServerEntry>;
  serve(handleRequest: HandleRequest, opts: ServeOptions): Promise<ServerHandle>;
}

export type ServeOptions = {
  port?: number;
  host?: string;
  signal?: AbortSignal;
};

export type ServerHandle = {
  url: string;
  close(): Promise<void>;
};
