import {VERSO_INTERNAL_URL_PREFIX} from "../core/common/constants";

export const DEFAULT_OUTDIR = 'dist';

export const BUILT_STATIC_DIRNAME = 'static';

// server bundles go in dist/server
export const SERVER_BUNDLE_DIR = 'server';
export const SERVER_ENTRY_FILENAME = 'entry.js';
export const SERVER_ENTRY_PATH = SERVER_BUNDLE_DIR + '/' + SERVER_ENTRY_FILENAME;

// client bundles go in dist/client...
export const CLIENT_BUNDLE_DIR = 'client';
// ...but they're served from /__verso/bundles
export const CLIENT_BUNDLE_URL_PREFIX = VERSO_INTERNAL_URL_PREFIX + '/bundles/';

// the manifest is written during the client build and streamed
// to the client during pageload.
export const MANIFEST_FILENAME = 'manifest.js';

// used during client build
export function clientAssetPathToUrl(assetPath: string) {
  return CLIENT_BUNDLE_URL_PREFIX + assetPath;
}

// used during server runtime (to serve bundles to client)
export function clientAssetUrlToPath(assetUrl: string) {
  return CLIENT_BUNDLE_DIR + '/' + assetUrl.substring(CLIENT_BUNDLE_URL_PREFIX.length);
}

// verso needs to know the paths of some of its own build artifacts.
// we define them here, but the source of truth is unfortunately in
// tsup config, which cannot import from here. just listing them here
// so the dependency is explicit.
export const VERSO_ENTRY = {
  createServerFactory: 'build.js',
  createVersoServer: 'server.js',
  bootstrapClient: 'client.js',
};
