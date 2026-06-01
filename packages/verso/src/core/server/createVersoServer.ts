import {runWithServerRLS} from "../common/RequestLocalStorage";
import type {ServerSettings} from "../../build/config";
import type {Resolver} from "../common/resolver";
import {resolvePublicRequest} from "./resolvePublicRequest";
import {runVerso} from "./runVerso";
import {handleFailsafeTimeouts} from "./failsafe";
import {compose, type RequestHandler} from "../../vendor/hattip/compose";
import type {AdapterRequestContext} from "../../vendor/hattip/core";
import type {ClientManifest} from "../../build/manifest";

type ServerDeps = {
  resolver: Resolver;
  manifest: ClientManifest | null;
  serveInternal: RequestHandler;
  serveStatic: RequestHandler;
  settings: ServerSettings;
};

// TODO this type should probably live somewhere more centralized
export type Serve = (request: Request) => Promise<Response>;

export interface VersoServer {
  serve: Serve;
}

export type CreateVersoServer = (deps: ServerDeps) => VersoServer;

export const createVersoServer: CreateVersoServer = ({
  resolver,
  manifest,
  serveInternal,
  serveStatic,
  settings,
}): VersoServer => {
  let serve: Serve;

  // for loopback fetch() requests
  const loopback: Serve = async (req) => {
    return await serve(req);
  };

  const hattipHandler = compose(
    handleError,
    resolvePublicRequest(settings),
    serveInternal,
    serveStatic,
    // failsafe runs after the bundle/static serving, because we
    // don't want to cut off the output stream of a raw file; we
    // know it's bounded
    handleFailsafeTimeouts(settings),
    runVerso({resolver, manifest, loopback, settings}),
  );

  serve = (req: Request) => runWithServerRLS(async () => {
    const ctx: AdapterRequestContext = {
      request: req,
      ip: '', // TODO
      platform: {},
      env: (name) => process.env[name],
      passThrough: () => {}, // we use the default 404 response
      waitUntil: () => {}, // only for certain edge runtimes
    };
    return await hattipHandler(ctx);
  });

  return {
    serve,
  };
}

const handleError: RequestHandler = (ctx) => {
  ctx.handleError = (error) => {
    console.error("[verso] Unexpected error in handleRequest:", error);
    return new Response("Internal Server Error", {
      status: 500,
    });
  }
}
