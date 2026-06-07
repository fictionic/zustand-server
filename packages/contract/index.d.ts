// @verso-js/contract
//
// The build/runtime contract that adapter and runtime packages program against.
// A pure types package: hand-authored declarations, no build step, no runtime
// code. verso, the runtime packages (e.g. node-runtime), and the adapter
// packages (e.g. adapter-node) all depend on it, which is what keeps their
// dependency graph acyclic. verso re-exports these types from its own modules,
// so its internal call sites are unchanged.

// --- server runtime contract ----------------------------------------------

/** A web-standard request handler: the boundary every runtime adapter bridges to. */
export type Serve = (request: Request) => Promise<Response>;

/**
 * An object representing a server. For now it's mostly redundant with Serve,
 * but it's more readable to pass around a 'server' object than a 'serve' function.
 * And eventually this might have more stuff in it, maybe?
 */
export interface Server {
  serve: Serve;
}

/** Everything the built server entry needs from its host to come alive. */
export type ServerRuntime = {
  manifest: ClientManifest;
  loadBundle: (bundleBasename: string) => Promise<Uint8Array | null>;
  /** If true, bypasses the allowedHosts check for localhost:* Hosts. For dev/preview mode only. */
  allowLoopbackHosts?: boolean;
};

/** Default export of the built server entry; turns a runtime into a server. */
export type ServerFactory = (runtime: ServerRuntime) => Server;

// --- client manifest --------------------------------------------------------

export type ClientManifest = {
  global: RouteAssets;
  routes: {
    [routeName: string]: RouteAssets;
  };
};

export type RouteAssets = {
  scripts: string[];
  stylesheets: string[];
};

// --- build-time adapter contract --------------------------------------------

export type BuildAdapter = {
  name: string;
  adapt: (b: BuildContext) => Promise<void>;
};

export type BuildContext = {
  paths: BuildPaths;
  writeEntry: (contents: string) => Promise<void>;
};

export type BuildPaths = {
  serverEntryBasename: string;
  clientManifestBasename: string;
  clientBundleDirBasename: string;
  staticDirBasename: string;
};
