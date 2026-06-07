# @verso-js/contract

The build/runtime contract that Verso adapter and runtime packages program
against — the types shared between `@verso-js/verso`, the runtime packages
(e.g. `@verso-js/node-runtime`), and the adapter packages
(e.g. `@verso-js/adapter-node`).

It is a **leaf package with no dependencies**. Everyone depends on it; it
depends on nothing. That is what keeps the package graph acyclic: verso needs
the runtime/adapter packages' *values*, while they need verso's *types* — so the
types live here instead, and nobody has to depend back on verso.

`@verso-js/verso` re-exports these types from its own modules, so its internal
call sites import from their existing local paths unchanged.
