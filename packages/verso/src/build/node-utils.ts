import type http from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export function toURL(nodeReq: http.IncomingMessage): URL {
  const proto = nodeReq.headers['x-forwarded-proto'] ?? 'http';
  const host = nodeReq.headers.host ?? `localhost:0`;
  return new URL(nodeReq.url ?? '/', `${proto}://${host}`);
}

export function toWebRequest(nodeReq: http.IncomingMessage, nodeRes: http.ServerResponse, url: URL): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeReq.headers)) {
    if (value) {
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) {
        headers.append(key, v);
      }
    }
  }
  const controller = new AbortController();
  nodeRes.once('close', () => {
    if (!nodeRes.writableFinished) {
      controller.abort('client disconnect');
    }
  });
  return new Request(url, {
    method: nodeReq.method,
    headers,
    body: nodeReq.method !== 'GET' && nodeReq.method !== 'HEAD' ? nodeReq as any : undefined,
    signal: controller.signal,
    // @ts-expect-error duplex is needed for streaming request bodies
    duplex: 'half',
  });
}

export async function sendWebResponse(nodeRes: http.ServerResponse, response: Response) {
  nodeRes.statusCode = response.status;
  response.headers.forEach((value, key) => {
    nodeRes.setHeader(key, value);
  });
  if (!response.body) {
    nodeRes.end();
    return;
  }
  try {
    await pipeline(Readable.fromWeb(response.body as any), nodeRes);
  } catch (err: any) {
    if (err?.code === 'ERR_STREAM_UNABLE_TO_PIPE' || err?.code === 'ERR_STREAM_PREMATURE_CLOSE' || nodeRes.destroyed) {
      // client disconnect
      return;
    }
    throw err;
  }
}
