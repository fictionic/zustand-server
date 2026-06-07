import type {BuildAdapter} from "@verso-js/contract";
import type {StaticCacheOptions} from "./static";

export type BunAdapterOptions = {
  staticCacheOpts?: StaticCacheOptions;
};

/**
 * The Bun build adapter. Configure it in your Vite config:
 *
 *   import { bun } from "@verso-js/adapter-bun";
 *   verso({ adapter: bun() })
 *
 * `adapt()` emits a `#!/usr/bin/env bun` entry that boots the built app via
 * `bootBun`, imported from this same package's `/runtime` export. Keeping the
 * boot function on a separate export means this build-time factory never enters
 * the deployed entry's import graph.
 *
 * Unlike the node adapter, there is no separate runtime package: nothing in
 * verso core consumes bun's boot (dev and preview are node-pinned), so the only
 * consumer is the emitted entry. If that ever changes (e.g. preview-on-bun),
 * this is the point to extract a `bun-runtime` package.
 */
export function bun(opts?: BunAdapterOptions): BuildAdapter {
  return {
    name: 'bun',
    adapt: async ({ paths, writeEntry }) => {
      await writeEntry(`
#!/usr/bin/env bun
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootBun } from "@verso-js/adapter-bun/runtime";
const runDir = path.dirname(fileURLToPath(import.meta.url));
const paths = ${JSON.stringify(paths)};
await bootBun(runDir, paths, {
  port: Number(process.env.PORT) || 3000,
  hostname: process.env.HOST ?? '0.0.0.0',
  shutdownGraceMs: Number(process.env.SHUTDOWN_GRACE_MS) || 5000,
  staticCacheOpts: ${JSON.stringify(opts?.staticCacheOpts)},
});
`.trim(),
      );
    },
  };
}
