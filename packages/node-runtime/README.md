# @verso-js/node-runtime

Internal Node serving primitives for [Verso](../verso). Not intended for direct
use by applications.

This package holds the runtime code that serves a built Verso app on Node:
loading the built server entry + client manifest, fronting static assets, the
Node ↔ web `Request`/`Response` bridge, and the `http.Server` boot/lifecycle
(including graceful shutdown).

It is consumed in two places:

- **`@verso-js/adapter-node`** — its generated production entry imports the boot
  function from here.
- **`@verso-js/verso`** — the dev and preview servers reuse these primitives.

Its dependency on `@verso-js/verso` is **type-only** (the build/runtime
contract), so the emitted JavaScript has no runtime dependency on core.
