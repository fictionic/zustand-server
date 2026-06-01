import type {VersoServer} from "../../core/server/createVersoServer";
import type {RequestHandler} from "../../vendor/hattip/compose";

export interface RuntimeAdapter {
  /**
   * turn an absolute fs path into something this runtime can import()
   */
  importModule<T>(absPath: string): Promise<T>;
  /**
   * read a build artifact's bytes; null if it doesn't exist
   */
  readArtifact(absPath: string): Promise<Uint8Array | null>;
  /**
   * create a Hattip handler for serving static content
   */
  createStaticHandler: (absBasePath: string) => RequestHandler;
  /**
   * bridge verso's web handler to this runtime's HTTP server
   */
  serve(versoServer: VersoServer, opts: ServeOptions): Promise<ServerHandle>;
}

export type ServeOptions = {
  port: number;
  hostname: string;
  signal: AbortSignal;
};

export type ServerHandle = {
  url: string;
  close(): Promise<void>;
};
