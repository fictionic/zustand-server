import {runWithServerRLS} from "../common/RequestLocalStorage";
import type {ServerSettings} from "../../build/config";
import type {Resolver} from "../common/resolver";
import {resolvePublicRequest} from "./resolvePublicRequest";
import {runApp} from "./runApp";
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
    // (we use the default error handler from Hattip (logs and returns 500))
    // first set the Request's url property based on headers
    resolvePublicRequest(settings, allowLoopbackHosts),
    // then handle serving bundles/etc (depends on dev vs prod)
    serveInternal,
    // then set up the failsafe handlers: user-configurable timeouts for
    // response-start (ttfb) and response-end.
    // (note that this runs after the bundle/static serving, because we
    // don't want to cut off the output stream of a raw file; we
    // know it's bounded.)
    handleFailsafeTimeouts(settings),
    // now we can do the thing we came here to do
    runApp({ resolver, manifest, loopback, settings }),
  );

  serve = (req: Request) => runWithServerRLS(async () => {
    const ctx: AdapterRequestContext = {
      request: req,
      ip: '', // TODO
      platform: {},
      env: (name) => process.env[name],
      passThrough: () => {}, // we use the default 404 response from Hattip
      waitUntil: () => {}, // only for edge runtimes (to do later, maybe)
    };
    return await hattipHandler(ctx);
  });

  return {
    serve,
  };
}
