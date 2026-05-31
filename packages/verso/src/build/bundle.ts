// holds the assets needed by the server.
// loadBundle is a function so as to be runtime-agnostic,
// implemented by the adapter
export type ServerAssets = {
  manifest: ClientManifest; // needed for serving assets to the client
  loadBundle: LoadBundle;
  runDir: string; // needed for serving static content
};

export type LoadBundle = (bundleBasename: string) => Promise<Uint8Array | null>;

// holds all the assets need by the client.
// used by the server for loading bundles on initial pageload.
// used by the client for swapping stylesheets during page transitions (build mode only).
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
