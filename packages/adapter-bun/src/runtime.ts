import path from "node:path";
import {pathToFileURL} from "node:url";
import type {
  BuildPaths,
  ClientManifest,
  ServerFactory,
  Serve,
} from "@verso-js/contract";
import {createFileLoader} from "./file";
import {createStaticFileServer, type StaticCacheOptions} from "./static";

type ServeOptions = {
  port: number;
  hostname: string;
  shutdownGraceMs: number;
  staticCacheOpts: StaticCacheOptions;
};

/**
 * Boot a built Verso app on Bun. Imported (via `@verso-js/adapter-bun/runtime`)
 * by the production entry the `bun()` adapter emits.
 *
 * Uses only Bun globals: `Bun.serve`'s `fetch` is web-native, so there's no
 * Node <-> web Request/Response bridge, and `Bun.file` fronts static assets, so
 * there's no sirv. Hence this package has no runtime dependencies.
 */
export async function bootBun(runDir: string, paths: BuildPaths, opts: ServeOptions): Promise<void> {
  const { port, hostname, shutdownGraceMs } = opts;

  const fetch = await createVersoBunHandler(runDir, paths, opts.staticCacheOpts);

  const server = Bun.serve({ port, hostname, fetch });
  console.log(`[verso-bun] listening on ${server.url.href}`);

  function shutdown() {
    // graceful: stop accepting connections and let in-flight requests drain.
    void server.stop();
    if (shutdownGraceMs > 0) {
      // backstop: anything still active after the grace period gets its
      // connection closed so the process can exit. (browsers can hold
      // keep-alive connections open even after pageload ends.)
      setTimeout(() => {
        console.log("forcing shutdown");
        void server.stop(true);
      }, shutdownGraceMs).unref();
    } else {
      void server.stop(true);
    }
  }

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

async function createVersoBunHandler(runDir: string, paths: BuildPaths, staticCacheOpts: StaticCacheOptions): Promise<Serve> {
  const {
    serverEntryBasename,
    clientManifestBasename,
    clientBundleDirBasename,
  } = paths;

  const { importDefault } = makeImporter(runDir);

  const bundleLoader = await createFileLoader(path.join(runDir, clientBundleDirBasename));

  const createServer = await importDefault<ServerFactory>(serverEntryBasename);
  const versoServer = createServer({
    manifest: await importDefault<ClientManifest>(clientManifestBasename),
    loadBundle: async (bundleBasename) => {
      const loaded = bundleLoader.loadFile(bundleBasename);
      if (!loaded) return null;
      return await loaded.file.bytes();
    },
  });

  const { staticDirBasename } = paths;
  const rootDir = path.join(runDir, staticDirBasename);
  const staticFileServer = await createStaticFileServer(rootDir, staticCacheOpts);

  return async (req: Request) => {
    const staticRes = await staticFileServer.tryServeStatic(req);
    if (staticRes) return staticRes;
    return await versoServer.serve(req);
  };
}

type Importer = {
  importDefault<T>(dirPath: string): Promise<T>;
}

function makeImporter(dirPath: string): Importer {
  return {
    importDefault: async <T>(basename: string) => (await import(pathToFileURL(path.resolve(dirPath, basename)).href)).default as T,
  };
}

