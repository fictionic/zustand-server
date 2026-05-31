import {runWithServerRLS} from "../common/RequestLocalStorage";
import type {ServerSettings} from "../../build/config";
import type {Resolver} from "../common/resolver";
import {resolvePublicRequest} from "./resolvePublicRequest";
import {serveStaticContent} from "./static";
import {runVerso} from "./runVerso";
import {handleFailsafeTimeouts} from "./failsafe";
import {compose, type RequestHandler} from "../../vendor/hattip/compose";
import type {AdapterRequestContext} from "../../vendor/hattip/core";
import type {ClientManifest} from "../../build/bundle";

export type MakeHandleRequest = (opts: {
  resolver: Resolver;
  manifest: ClientManifest | null;
  serveInternalAssets: RequestHandler;
  resolvedStaticDir: string | null;
  settings: ServerSettings;
}) => HandleRequest;

export type HandleRequest = (request: Request) => Promise<Response>;

export const makeHandleRequest: MakeHandleRequest = ({
  resolver,
  manifest,
  serveInternalAssets,
  resolvedStaticDir,
  settings,
}): HandleRequest => {
  let handleRequest: HandleRequest;

  // for loopback fetch() requests
  const loopback: HandleRequest = async (req) => {
    return await handleRequest(req);
  };

  const hattipHandler = compose(
    handleError,
    handleFailsafeTimeouts(settings),
    resolvePublicRequest(settings),
    serveInternalAssets,
    serveStaticContent(resolvedStaticDir),
    runVerso({resolver, manifest, loopback, settings}),
  );

  handleRequest = (req: Request) => runWithServerRLS(async () => {
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

  return handleRequest;
}

const handleError: RequestHandler = (ctx) => {
  ctx.handleError = (error) => {
    console.error("[verso] Unexpected error in handleRequest:", error);
    return new Response("Internal Server Error", {
      status: 500,
    });
  }
}
