import http from 'node:http';
import type {BuildPaths} from "@verso-js/contract";
import {type Options as SirvOptions} from "sirv";
import {createVersoNodeHandler} from './handler';

type ServeOptions = {
  port: number;
  hostname: string;
  shutdownGraceMs: number;
  sirvOpts?: SirvOptions;
};

export async function bootNode(runDir: string, paths: BuildPaths, opts: ServeOptions): Promise<void> {
  const { port, hostname, shutdownGraceMs, sirvOpts } = opts;

  const handler = await createVersoNodeHandler({ runDir, paths, sirvOpts });

  const server = http.createServer(handler);

  await new Promise<void>((resolve) => {
    server.listen(port, hostname, () => resolve());
  });
  console.log(`[verso-node] listening on ${formatUrl(server)}`);

  function forceShutdown() {
    server.closeAllConnections();
  }

  async function shutdown() {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => err ? reject(err) : resolve());
      if (shutdownGraceMs <= 0) {
        forceShutdown();
        return;
      }
      console.log("attempting graceful shutdown...");
      // server.close() waits for existing connections to end but won't close
      // idle keep-alive sockets itself, so reap them now or shutdown hangs.
      server.closeIdleConnections();
      setTimeout(() => {
        // backstop: anything still streaming after the grace period gets
        // its connection destroyed so the process can exit.
        // (browsers can keep connections open even after pageload ends.)
        console.log("forcing shutdown");
        forceShutdown();
      }, shutdownGraceMs).unref();
    });
  }

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

function formatUrl(server: http.Server): string {
  const addr = server.address();
  if (addr === null) return '[server not running]';
  if (typeof addr === 'string') return addr; // unix socket
  // 0.0.0.0 / :: mean "all interfaces" -- show localhost instead, that's what users click
  const host = (addr.address === '::' || addr.address === '0.0.0.0')
    ? 'localhost'
    : addr.family === 'IPv6' ? `[${addr.address}]` : addr.address;
  return `http://${host}:${addr.port}`;
}
