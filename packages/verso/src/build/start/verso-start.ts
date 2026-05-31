import type {RuntimeAdapter, ServeOptions} from './adapter';

export async function runStart(adapter: RuntimeAdapter, opts: ServeOptions = {}) {
  const serverAssets = await adapter.loadAssets();
  const { getServer } = await adapter.loadServerEntry();
  const versoServer = await getServer(serverAssets);
  const handle = await adapter.serve(versoServer.serve, { port: 3000, ...opts });
  console.log(`[verso] Server started on ${handle.url}`);
}
