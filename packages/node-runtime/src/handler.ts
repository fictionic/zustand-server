import {existsSync} from "node:fs";
import {pathToFileURL} from "node:url";
import path from "node:path";
import {readFile} from "node:fs/promises";
import sirv, {type Options as SirvOptions} from "sirv";
import type {BuildPaths, ClientManifest, ServerFactory} from "@verso-js/contract";
import {toNodeRequestHandler, type NodeRequestHandler} from "./util";

const DEFAULT_SIRV_OPTIONS: SirvOptions = { maxAge: 86400, etag: true };

type CreateVersoNodeHandlerOpts = {
  runDir: string;
  paths: BuildPaths;
  sirvOpts?: SirvOptions;
  allowLoopbackHosts?: boolean;
};

export async function createVersoNodeHandler({ runDir, paths, sirvOpts, allowLoopbackHosts }: CreateVersoNodeHandlerOpts): Promise<NodeRequestHandler> {
  const { serverEntryBasename, clientManifestBasename, clientBundleDirBasename } = paths;
  const { importDefault } = makeImporter(runDir);
  const createServer = await importDefault<ServerFactory>(serverEntryBasename);
  const versoServer = createServer({
    manifest: await importDefault<ClientManifest>(clientManifestBasename),
    loadBundle: async (bundleBasename: string) => {
      try {
        // TODO: load all bundle contents in memory upfront?
        return await readFile(path.resolve(runDir, clientBundleDirBasename, bundleBasename));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      }
    },
    allowLoopbackHosts,
  });

  const handleVerso = toNodeRequestHandler(versoServer.serve);

  // serve built static assets at the node edge (real req/res, no web-Request
  // roundtrip), falling through to verso on a miss. sirv already speaks the
  // (req, res, next) contract, so verso is just its `next`. the static dir is
  // absent when the app has no publicDir.
  const staticDir = path.join(runDir, paths.staticDirBasename);
  const filledSirvOpts = Object.assign({}, DEFAULT_SIRV_OPTIONS, sirvOpts);
  const handleStatic = existsSync(staticDir) ? sirv(staticDir, filledSirvOpts) : null;

  if (!handleStatic) {
    return handleVerso;
  }

  return (req, res) => {
    handleStatic(req, res, () => handleVerso(req, res));
  }
}

type Importer = {
  importDefault<T>(dirPath: string): Promise<T>;
}

function makeImporter(dirPath: string): Importer {
  return {
    importDefault: async <T>(basename: string) => (await import(pathToFileURL(path.resolve(dirPath, basename)).href)).default as T,
  };
}

