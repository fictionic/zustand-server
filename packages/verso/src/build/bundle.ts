// holds the assets needed by the server.
// loadBundle is a function so as to be runtime-agnostic,
// implemented by the adapter
export type ServerAssets = {
  manifest: BundleManifest;
  loadBundle: LoadBundle;
  runDir: string; // needed for serving static content
};

export type LoadBundle = (bundleBasename: string) => Promise<Uint8Array | null>;

// holds all the assets for each route.
// used by the server for loading bundles on initial pageload.
// used by the client for swapping stylesheets during page transitions.
export type BundleManifest = {
  [routeName: string]: RouteAssets;
};

export type RouteAssets = {
  scripts: string[];
  preloads: string[];
  stylesheets: string[];
};
