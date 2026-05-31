import type {RuntimeAdapter} from "./adapter";
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { ClientManifest } from '../bundle';
import { DEFAULT_OUTDIR, MANIFEST_FILENAME, SERVER_ENTRY_PATH } from '../constants';
import {pathToFileURL} from "node:url";
import { toWebRequest } from '../../vendor/hattip/node-request';
import { sendWebResponse } from '../../vendor/hattip/node-response';

export function getAdapter(outDir = DEFAULT_OUTDIR): RuntimeAdapter {
  return {
    loadAssets: async () => {
      // TODO: adapters shouldn't have to know the manifest filename...
      const manifestPath = path.resolve(outDir, MANIFEST_FILENAME);
      const manifest: ClientManifest = (await import(manifestPath)).default;

      return {
        manifest,
        loadBundle: async (bundleBasename) => {
          try {
            return await readFile(path.resolve(outDir, bundleBasename));
          } catch (err) {
            if ((err as ErrnoException).code === 'ENOENT') {
              return null
            }
            throw err;
          }
        },
        runDir: path.resolve(outDir),
      };
    },

    loadServerEntry: async () => {
      const serverEntryPath = pathToFileURL(path.resolve(outDir, SERVER_ENTRY_PATH)).href;
      return await import(serverEntryPath);
    },

    serve: async (handleRequest, opts) => {
      const { port, host, signal } = opts;

      const server = http.createServer(async (nodeReq, nodeRes) => {
        try {
          const request = toWebRequest(nodeReq, nodeRes);
          const response = await handleRequest(request);
          await sendWebResponse(nodeReq, nodeRes, response);
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
