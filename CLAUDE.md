
## Project Overview

**Verso** is a streaming SSR framework, and **isomorphic-stores** is its state management layer — an adapter system for plugging Zustand, Redux, etc. into Verso's SSR model. (It was originally intended to be SSR-framework-agnostic, but `stores/` is now coupled to Verso — see Key conventions.)

Verso owns the server and the bundler. It ships as a Vite plugin (`build/plugin.ts`, exported async as `verso()`). Configuration lives in a dedicated `verso.config.ts` via `defineConfig` from `@verso-js/verso/config` (`server`/`client`/`middleware`/`routes`); `vite.config.ts` just calls `await verso()` with no options. The user does not own a server file.

### Architecture

**Server request flow:** `serve` wraps the request in `runWithServerRLS` (enters `AsyncLocalStorage`) and runs a composed Hattip chain: `resolvePublicRequest` (host allowlist, public URL) → `serveInternal` (bundle serving) → failsafe timeouts → `runApp`. `runApp` resolves the route via the resolver (`createHandlerChain` builds page + middleware), calls `getRouteDirective` (data fetching, redirects), then `handlePage`. All data fetching happens during `getRouteDirective`, before streaming begins. By the time `handlePage` runs, every fetch is already in-flight or resolved in the cache. Root `when` promises reference these already-initiated fetches — they do not start new ones.

**Streaming:** `handlePage` streams through a `TransformStream`. `writePage` writes `<head>` synchronously, then `writeBody` (in `PageElementProcessor`) renders roots via a token queue (PENDING → RENDERED → PROCESSED). Each root's `scheduleRootRender` (`components/Root.tsx`) resolves a React element, which is `renderToString`'d. Roots are written in order — a slow root blocks later ones. On abort/timeout, still-PENDING roots are marked ABORTED. After the body, `bootstrapClient` dehydrates the fetch cache and injects `<script>` tags. Late-arriving fetch responses are piped to the client via `VersoPipe` after the fold.

**Client hydration:** `ClientController` reads the `VersoPipe`, rehydrates the fetch cache, then hydrates React roots as their DOM nodes stream in. `VersoPipe.onCallFn(FN_HYDRATE_ROOTS_UP_TO)` triggers hydration progressively. `window.__waitForVersoNavigation` (set in `core/client/navigation.ts`, declared in `defines.d.ts`) lets callers await hydration/navigation completion.

**Client navigation (SPA transitions):** `ClientController.navigate()` re-runs the handler chain client-side, then commits a transition that swaps the page in place rather than reloading. A set of transitioners (`core/client/transitioners/`) handle each part of the document:

- `StyleTransitioner` (`styles.ts`) swaps per-route stylesheets, deferring teardown of the old route's styles until the new body is in place to avoid FOUC (and reconciling against Vite's injected `<style>` tags in dev).
- `ScriptTransitioner` (`scripts.ts`) tracks existing scripts and only adds newly-needed ones.
- Title, link tags, and meta tags are swapped out wholesale; the body className is replaced.
- `BodyElementTransitioner` (`body.ts`) swaps the body's roots/containers. **It runs the same `PageElementProcessor` algorithm as the server render** — but its consume callback performs DOM mutations instead of writing to an HTTP stream. Tokens are processed in declaration order (out-of-order would be possible client-side, but in-order keeps client navigation consistent with server pageload).

The body swap has two paths, controlled by the `reuseDom` setting (a `ClientSettings` default, overridable per-navigation via `navigate()` options):

- **reuseDom:** for each token it finds the existing DOM node at that index and, if the kind matches, updates its attrs and lets React reconcile the new element into the *existing* root (`reactRoot.render(element)`). On any shape mismatch (missing node, kind/index mismatch, lost root) it bails out, tears down the DOM from that index onward, and renders the remainder fresh. Trailing leftover elements from the old page are cleared at the end.
- **fresh (default):** old roots are unmounted and their DOM removed, then each new root gets a fresh `createRoot` + `flushSync(() => root.render(element))` (`flushSync` keeps roots mounting in order under the concurrent scheduler).

### Page composition model

Pages are **multi-root** — a page returns an array of React elements, not a single tree. The element array is tokenized into a flat stream of `Root`, `RootContainer`, `TheFold`, and container open/close tokens.

- **Root**: an independent React application. Each root is `renderToString`'d on the server and `hydrateRoot`'d on the client. Roots render in parallel but are written to the stream in order.
- **RootContainer**: a structural wrapper (`<div>` with props like `id`, `className`). Groups roots for layout. Not a rendered React component — it's metadata consumed by the tokenizer.
- **TheFold**: a control element that marks where client bootstrap happens. Roots before the fold stream as inert HTML; the client bootstraps at the fold (scripts injected, fetch cache dehydrated), then hydrates roots progressively as their DOM arrives. If omitted, bootstrap happens after the last root.

### Handler definitions

- `definePage(init)` and `defineEndpoint(init)` are the user-facing APIs for route handlers. `init` receives a `RouteHandlerCtx` with `getConfigValue` (a `MiddlewareConfig['getValue']`), `getRoute()` (returns `RouteInfo { name, params }`), and `getRequest()` (returns a `VersoRequest`).
- **Pages** must implement `getRouteDirective()` (returns `{ status, location?, hasDocument? }`) and `getElements()` (returns `ReactElement[]`). Optional: `getTitle()`, `getStylesheets()`, `getScripts()`, `getLinkTags()`, `getMetaTags()`, `getBodyClasses()`.
- **Endpoints** must implement `getRouteDirective()`, `getContentType()`, and `getResponseData()` (returns a `BodyInit` — e.g. string, ArrayBuffer, ReadableStream).
- `getRouteDirective()` and the optional `getHeaders()` are *shared* methods available to both pages and endpoints.
- Non-2XX page responses don't stream HTML unless `hasDocument: true` is set in the route directive.

### Routing

Routes are defined in config as a `RoutesMap`: `{ routeName: { path, handler, method? } }`. Uses `path-to-regexp` for matching. Routes are matched in declaration order (first match wins). The same route definitions are used on both client and server.

### Middleware

Middleware wraps handler methods via a `next()` chain (like Express). Defined with `defineMiddleware(scope, init)`. Each middleware can wrap any handler method — e.g., `getRouteDirective(next)` calls `next()` to delegate. Middleware can declare config keys via `addConfigValues()` and set them via `setConfigValues()`. Config keys must be pre-declared before handlers can read them.

### Fetch subsystem

`Fetch` (`core/common/fetch/Fetch.ts`) is an isomorphic fetch wrapper backed by `FetchCache`. It is the way app code should make data requests.

- **Server:** fetches go through native fetch, responses are cached in `FetchCache`. The cache is keyed by url + method + query + body. Deduplicates parallel requests to the same resource. The cache is dehydrated and sent to the client at bootstrap (before the fold).
- **Client:** on hydration, the cache is rehydrated from the server's dehydrated payload. Client-side `fetch()` calls hit the cache first; cache hits replay the server's response isomorphically. Post-hydration or cache-miss requests fall through to native fetch.
- **Late arrivals:** fetch requests still pending at the fold are "late arrivals." The server waits for them via `Promise.allSettled`, then pipes each resolved response to the client via `VersoPipe`'s `FN_RECEIVE_LATE_DATA_ARRIVAL`.
- **Interceptors:** `setFetchInterceptor` lets apps rewrite URLs/headers per-request (e.g. CSRF tokens, private origins). Does not affect the cache key.
- **Cookie forwarding:** same-origin server fetches automatically forward the page request's cookies. Cross-origin requires `credentials: 'include'` or `forceForwardRequestCookies`.

### Runtimes & adapters

Verso's core is runtime-agnostic — it programs against the **Web Fetch API**, exposed as `Serve = (request: Request) => Promise<Response>`. The Node HTTP layer is isolated behind a contract so other runtimes (e.g. a future edge adapter) can drop in.

- **`@verso-js/contract`** — a pure-types package (no runtime code) defining the build/runtime contract everyone programs against: `Serve`, `VersoServer`, `ServerRuntime`, `ServerFactory`, `BuildAdapter`, `BuildPaths`. Keeps the dependency graph between verso, the runtimes, and the adapters acyclic.
- **`@verso-js/node-runtime`** — the Node HTTP bridge: `http.createServer`, `IncomingMessage`/`ServerResponse` ↔ web `Request`/`Response` (the vendored hattip `node-request`/`node-response` live here, not in verso core), plus `sirv` static serving and graceful shutdown.
- **`@verso-js/adapter-node`** — the production Node build adapter, built on `node-runtime`.

The Vite plugin takes an `adapter` option; its `buildApp` builds the client + ssr environments, then calls `adapter.adapt(...)` to write the runnable `index.js`.

### Workspace layout

Bun workspace monorepo:

```
packages/
├── verso/                 # SSR framework — "@verso-js/verso"
├── contract/              # build/runtime types contract — "@verso-js/contract"
├── node-runtime/          # Node HTTP runtime — "@verso-js/node-runtime"
├── adapter-node/          # production Node build adapter — "@verso-js/adapter-node"
├── stores/                # isomorphic-stores core — "@verso-js/stores"
├── store-adapter-zustand/ # "@verso-js/store-adapter-zustand"
├── store-adapter-redux/   # "@verso-js/store-adapter-redux"
├── store-adapter-valtio/  # "@verso-js/store-adapter-valtio"
├── playwright/            # verso-specific Playwright fixtures — "@verso-js/playwright"
├── story-stores/          # "story-stores" (note: unscoped)
└── demo/                  # demo app
```

### Key conventions

- The demo package uses `@/*` as a path alias to its own `src/`. Non-demo packages use relative imports.
- `IS_SERVER` and `IS_DEV` are compile-time constants (declared in `defines.d.ts` at the package root, defined by the Vite plugin: `IS_SERVER` per-environment, `IS_DEV` globally). Use them for dead code elimination.
- `RequestLocalStorage.ts` provides isomorphic per-request state via `getRLS()`. On the server it's backed by `AsyncLocalStorage` (via `runWithServerRLS`); on the client it uses a module-level store managed by `startClientRLS()` / `stopClientRLS()`. `getRLS<T>()` is called at module scope and returns an `RLS` accessor — call `RLS()` to get the per-request object (a Proxy guards against forgetting the `()`). All request-path code must go through the same module loader or singletons break silently.
- `stores/` has no dependency on a *store* framework (the zustand/redux/valtio adapters are separate packages, integrated at the call site). It was originally intended to be SSR-framework-agnostic too, but that no longer holds: `stores/` now depends on `@verso-js/verso` and is coupled to Verso.
- Middleware scope defaults to `'page'`. Pass `'all'` or `'endpoint'` explicitly for other scopes.
- Cookies can only be set before streaming begins (i.e. during `getRouteDirective()` or handler init), not during element rendering.
- The Vite plugin produces a dual build under a shared `dist/`: client artifacts in `dist/client/` (ES modules, served under the `/__verso/bundles/` URL prefix) and the server bundle in `dist/server/` (static handler imports). Virtual modules generate the entrypoints. The client manifest is streamed to the client via `VersoPipe` during pageload, not served from a dedicated endpoint.

### TODOs
TODOs are tracked in ./TODO

---

## Dev runtime

Bun is used for running/building/installing during development, but framework core must avoid both Bun-specific *and* Node-specific APIs — it targets the Web Fetch standard (`Request`/`Response`). Node's HTTP layer is confined to `@verso-js/node-runtime`; Bun is dev tooling only.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun install`, `bun run <script>`, `bunx <package>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `vitest` to run tests from within `packages/verso/`. Config is in `packages/verso/vitest.config.ts`.

### Isomorphic test harness

`@verso-js/verso/testing/config` exports `versoProjects()`, which returns three vitest projects to spread into `test.projects`; one `vitest run` runs all three:

- **server** — node environment
- **client** — jsdom environment
- **hydration** — jsdom environment, for `testHydration()`

The active pass is the single source of truth (`src/userland/testing/pass.ts`). Each project declares its pass via vitest `provide: { versoPass }`; `getPass()` reads it live with `inject('versoPass')`. The test helpers (from `@verso-js/verso/testing`) gate on the pass — there are **no filename conventions and no include/exclude juggling**:

- `serverSide(fn)` / `clientSide(fn)` — run `fn` only in the server / client pass; self-skip elsewhere. DOM-dependent assertions go in `clientSide` (jsdom).
- `testHydration(desc, () => element)` — runs only in the hydration pass. Renders the element with `IS_SERVER=true` via `renderToString`, plants the markup, hydrates with `IS_SERVER=false` via real ReactDOM, and fails on any hydration mismatch React reports (`onRecoverableError`). `render` is invoked once per phase, so construction-time branching is caught too.
- `devOnly(fn)` — toggles `IS_DEV` per-test.

Key invariants:
- **`IS_SERVER` is a runtime global derived from the pass** (like `IS_DEV`), set in the setup file from `inject('versoPass')` — not a build-time `define`. That's what lets `testHydration()` flip it across phases. Verso's tests don't rely on define-based dead-code elimination.
- **Out-of-pass helpers register nothing** (no skipped-test placeholders, to keep output clean), so a file is empty in the passes it doesn't apply to. Each project sets `passWithNoTests: true` so that's not an error.
- **vitest does not apply `resolve.alias` to `setupFiles`** and honors package `exports` (→ dist), so a setup *specifier* can't be redirected to source. `versoProjects` instead resolves the setup to an absolute path from `import.meta.url` (source `setup.ts` when run from src, built `testing-setup.js` when consumed). Don't reintroduce an alias for this — it silently no-ops.

### E2E tests

E2E tests use Playwright in `packages/demo/e2e/`. Three suites: `smoke.spec.ts`, `stores.spec.ts`, `transitions.spec.ts`.

Run with:
- `cd packages/demo && bunx playwright test -c playwright.dev.config.ts` (or `bun run test:e2e`)
- `cd packages/demo && bunx playwright test -c playwright.prod.config.ts` (or `bun run test:e2e:prod`)

Fixtures (`e2e/helpers/fixtures.ts`):
- Composes `versoFixtures` from `@verso-js/playwright` (which patches `page.goto` to wait for verso client hydration) with a local `consoleErrors` fixture. Import `test` and `expect` from `./helpers/fixtures`.
- `consoleErrors` fixture auto-asserts no console errors after each test.
- Card components use `data-card` attribute for stable test locators.
