import type {RuntimeAdapter} from "./adapter";
import http from 'node:http';
import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import type { BundleManifest } from '../bundle';
import { BUNDLES_DIR, MANIFEST_PATH, SERVER_ENTRY_PATH } from '../constants';
import {pathToFileURL} from "node:url";
import { toURL, toWebRequest, sendWebResponse } from '../node-utils';

export function getAdapter(outDir = 'dist'): RuntimeAdapter {
  return {
    loadAssets: async () => {
      const manifestPath = path.resolve(outDir, MANIFEST_PATH);
      const manifest: BundleManifest = (await import(manifestPath)).default;

      const bundlesDir = path.resolve(outDir, BUNDLES_DIR);
      const files = await readdir(bundlesDir);
      const bundleContents: Record<string, string> = {};
      await Promise.all(
        files.map(async (file) => {
          const bundlePath = `${BUNDLES_DIR}/${file}`;
          bundleContents[bundlePath] = await readFile(path.resolve(outDir, bundlePath), 'utf-8');
        })
      );
      return {
        manifest,
        bundleContents,
      };
    },

    loadServerEntry: async () => {
      const serverEntryPath = pathToFileURL(path.resolve(outDir, SERVER_ENTRY_PATH)).href;
      return await import(serverEntryPath);
    },

    serve: async (handler, opts) => {
      const { port, host, signal } = opts;

      const server = http.createServer(async (nodeReq, nodeRes) => {
        try {
          const url = toURL(nodeReq);
          const request = toWebRequest(nodeReq, nodeRes, url);
          const response = await handler(request);
          await sendWebResponse(nodeRes, response);
        } catch (e) {
          if (nodeRes.destroyed || nodeRes.writableEnded) {
            return;
          }
          console.error('[verso]', e);
          nodeRes.statusCode = 500;
          nodeRes.end();
        }
      });

      await new Promise<void>((resolve) => {
        server.listen(port, host, () => resolve());
      });

      const close = () => new Promise<void>((resolve, reject) => {
        server.close((err) => err ? reject(err) : resolve());
      });

      signal?.addEventListener('abort', () => { void close(); }, { once: true });

      return {
        url: formatUrl(server),
        close,
      };
    }
  };

}

function formatUrl(server: http.Server): string {
  const addr = server.address();
  if (addr === null) return '[server not running]';
  if (typeof addr === 'string') return addr; // unix socket
  // 0.0.0.0 / :: mean "all interfaces" — show localhost instead, that's what users click
  const host = (addr.address === '::' || addr.address === '0.0.0.0')
    ? 'localhost'
    : addr.family === 'IPv6' ? `[${addr.address}]` : addr.address;
  return `http://${host}:${addr.port}`;
}
