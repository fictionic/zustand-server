import sirv from 'sirv';
import {toReqRes, toFetchResponse} from 'fetch-to-node';
import type {RequestHandler} from '../vendor/hattip/compose';

/**
 * static file serving handler for node, built with sirv
 */
type Opts = {
  isDev?: boolean;
};
export function serveStaticContent(dir: string | null, opts?: Opts): RequestHandler {
  if (!dir) {
    return () => {};
  }
  const assets = sirv(dir, {
    maxAge: 3600,
    dev: opts?.isDev ?? false,
  });
  return (ctx) => new Promise<Response | void>((resolve, reject) => {
    const { req: nodeReq, res: nodeRes } = toReqRes(ctx.request);
    assets(nodeReq, nodeRes, () => resolve());
    toFetchResponse(nodeRes).then(resolve, reject);
  });
}
