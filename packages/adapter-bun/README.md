# @verso-js/adapter-bun

The [Verso](../verso) build adapter for the Bun runtime.

```ts
// vite.config.ts
import { bun } from "@verso-js/adapter-bun";

export default {
  plugins: [verso({ adapter: bun() })],
};
```

At build time, `bun()` emits a `#!/usr/bin/env bun` entry into the output
directory. At runtime that entry imports `bootBun` from this package's
`./runtime` export and serves the built app with `Bun.serve` — using `Bun.file`
to front static assets. Because `Bun.serve` is web-native and `Bun.file` does
zero-copy file serving, this package has **no runtime dependencies** (no
Node ↔ web bridge, no sirv).

## Why one package (and not a separate `bun-runtime`)

`@verso-js/adapter-node` is paired with `@verso-js/node-runtime` because verso
core reuses the node serving primitives for its dev and preview servers. Bun has
no such consumer — dev and preview are node-pinned — so bun's boot is consumed
only by the emitted entry. It therefore lives in this package, split onto the
`./runtime` export so the build-time `bun()` factory stays out of the deployed
entry's import graph. If a second consumer ever appears (e.g. preview-on-bun),
that's the point to extract a `bun-runtime` package.
