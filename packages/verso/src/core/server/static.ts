import sirv from 'sirv';
import {toReqRes, toFetchResponse} from 'fetch-to-node';
import {isDev} from '../common/env';
import type {RequestHandler} from '../../vendor/hattip/compose';

export function serveStaticContent(resolvedStaticDir: string | null): RequestHandler {
  if (!resolvedStaticDir) {
    return () => {};
  }
  const assets = sirv(resolvedStaticDir, {
    maxAge: 3600,
    dev: isDev(),
  });
  return (ctx) => new Promise<Response | void>((resolve, reject) => {
    const { req: nodeReq, res: nodeRes } = toReqRes(ctx.request);
    assets(nodeReq, nodeRes, () => resolve());
    toFetchResponse(nodeRes).then(resolve, reject);
  });
}
