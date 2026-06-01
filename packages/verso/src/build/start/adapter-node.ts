import type {RuntimeAdapter} from "./adapter";
import http from 'node:http';
import {pathToFileURL} from "node:url";
import { toWebRequest } from '../../vendor/hattip/node-request';
import { sendWebResponse } from '../../vendor/hattip/node-response';
import {readFile} from "node:fs/promises";
import {serveStaticContent} from "../static";

// how long to let in-flight responses drain after an abort before
// forcibly destroying their connections.
// TODO: this should probably be configurable, for k8s
const SHUTDOWN_GRACE_MS = 5000;

export function getAdapter(): RuntimeAdapter {
  return {
    importModule: (absPath) => import(pathToFileURL(absPath).href),

    readArtifact: async (absPath) => {
      try {
        return await readFile(absPath);
      } catch (err) {
        if ((err as ErrnoException).code === 'ENOENT') return null;
        throw err;
      }
    },

    createStaticHandler: (dir) => {
      return serveStaticContent(dir);
    },

    serve: async (versoServer, opts) => {
      const { port, hostname, signal } = opts;

      const server = http.createServer(async (nodeReq, nodeRes) => {
        try {
          const request = toWebRequest(nodeReq, nodeRes);
          const response = await versoServer.serve(request);
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
        server.listen(port, hostname, () => resolve());
      });

      const close = () => new Promise<void>((resolve, reject) => {
        server.close((err) => err ? reject(err) : resolve());
        // server.close() waits for existing connections to end but won't close
        // idle keep-alive sockets itself, so reap them now or shutdown hangs.
        server.closeIdleConnections();
      });

      signal.addEventListener('abort', () => {
        void close();
        // backstop: anything still streaming after the grace period gets
        // its connection destroyed so the process can exit.
        setTimeout(() => {
          server.closeAllConnections();
        }, SHUTDOWN_GRACE_MS).unref();
      }, { once: true });

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
