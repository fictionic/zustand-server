import {runWithServerRLS} from "../common/RequestLocalStorage";
import type {ServerSettings} from "../../build/config";
import type {Resolver} from "../common/resolver";
import {resolvePublicRequest} from "./resolvePublicRequest";
import {runVerso} from "./runVerso";
import {handleFailsafeTimeouts} from "./failsafe";
import {compose, type RequestHandler} from "../../vendor/hattip/compose";
import type {AdapterRequestContext} from "../../vendor/hattip/core";
import type {ClientManifest, Serve, Server} from "@verso-js/contract";

type ServerDeps = {
  resolver: Resolver;
  manifest: ClientManifest | null;
  serveInternal: RequestHandler;
  settings: ServerSettings;
  allowLoopbackHosts?: boolean;
};

export type CreateVersoServer = (deps: ServerDeps) => Server;

export const createVersoServer: CreateVersoServer = ({
  resolver,
  manifest,
  serveInternal,
  settings,
  allowLoopbackHosts,
}) => {
  let serve: Serve;

  // for loopback fetch() requests
  const loopback: Serve = async (req) => {
    return await serve(req);
  };

  const hattipHandler = compose(
    handleError,
    resolvePublicRequest(settings, allowLoopbackHosts),
    serveInternal,
    // failsafe runs after the bundle/static serving, because we
    // don't want to cut off the output stream of a raw file; we
    // know it's bounded
    handleFailsafeTimeouts(settings),
    runVerso({ resolver, manifest, loopback, settings }),
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
    console.error("[verso] Unexpected error", error);
    return new Response("Internal Server Error", {
      status: 500,
    });
  }
}
