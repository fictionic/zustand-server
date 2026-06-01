import path from 'node:path';
import type {ClientManifest} from '../manifest';
import type {RuntimeAdapter, ServeOptions} from './adapter';
import {MANIFEST_FILENAME, SERVER_ENTRY_PATH} from '../constants';
import type {ServerEntry} from '../entrypoint';
import type {ServerRuntime} from '../createServerFactory';

export async function runStart(adapter: RuntimeAdapter, outDir: string, opts: ServeOptions) {
  const { default: manifest } = (await adapter.importModule<{ default: ClientManifest }>(path.resolve(outDir, MANIFEST_FILENAME)));
  const { default: createServer } = await adapter.importModule<ServerEntry>(path.resolve(outDir, SERVER_ENTRY_PATH));
  const serverRuntime: ServerRuntime = {
    manifest,
    loadBundle: (basename: string) => adapter.readArtifact(path.resolve(outDir, basename)),
    serveStatic: adapter.createStaticHandler(path.resolve(outDir)),
  };
  const versoServer = createServer(serverRuntime);
  const handle = await adapter.serve(versoServer, opts);
  console.log(`[verso] Server started on ${handle.url}`);
}
