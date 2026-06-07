import type {BuildAdapter} from "@verso-js/contract";
import type {Options as SirvOptions} from "sirv";

export type NodeAdapterOptions = {
  // TODO somehow let users pass a non-serializable options object?
  sirvOpts: Pick<SirvOptions, 'maxAge' | 'etag' | 'immutable'>;
};

export function node(options?: NodeAdapterOptions): BuildAdapter {
  return {
    name: 'node',
    adapt: async ({ paths, writeEntry }) => {
      await writeEntry(`
#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootNode } from "@verso-js/node-runtime";
const runDir = path.dirname(fileURLToPath(import.meta.url));
const paths = ${JSON.stringify(paths)};
const opts = {
  port: Number(process.env.PORT) || 3000,
  hostname: process.env.HOST ?? '0.0.0.0',
  shutdownGraceMs: Number(process.env.SHUTDOWN_GRACE_MS) ?? 5000,
  sirvOpts: ${JSON.stringify(options?.sirvOpts)},
};
await bootNode(runDir, paths, opts);
     `.trim(),
      );
    },
  };
}
