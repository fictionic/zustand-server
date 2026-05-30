import type {RuntimeAdapter, ServeOptions} from './adapter';

export async function runStart(adapter: RuntimeAdapter, opts: ServeOptions = {}) {
  const bundleResult = await adapter.loadAssets();
  const { getServer } = await adapter.loadServerEntry();
  const versoServer = await getServer(bundleResult);
  const handle = await adapter.serve(versoServer.serve, { port: 3000, ...opts });
  console.log(`[verso] Server started on ${handle.url}`);
}
