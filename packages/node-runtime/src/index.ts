// @verso-js/node-runtime
//
// Node serving primitives for Verso. This is an internal package: apps never
// import it directly. The node adapter's generated entry imports it at runtime,
// and verso core uses it for the dev and preview servers. Keeping it out of
// `@verso-js/verso` is what keeps `bootNode` off core's public export surface.
//
// Its only dependency on `@verso-js/verso` is type-only (the build/runtime
// contract: Serve, BuildPaths, ServerFactory/ServerRuntime, ClientManifest), so
// the emitted JS has no runtime dependency on core.
//
export * from './boot';
export * from './handler';
export * from './util';
