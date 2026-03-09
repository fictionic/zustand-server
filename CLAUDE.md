
## Project Overview

A framework-agnostic SSR state management library with an adapter system. The core idea: stores are created server-side before render (e.g. in `handleRoute`), async data is declared via `waitFor`, and the SSR framework (e.g. react-server's `RootElement`) blocks rendering until the store is ready. Client-side components can also create stores independently via `useCreateClientStore`.

Originally conceived as a Zustand+react-server bridge, now being generalized to support any store-based framework (single state object with `getState`/`setState`/`subscribe`). Atom-based frameworks (Jotai, Recoil) are out of scope.

### Key files
- `src/core.ts` — framework-agnostic core (`defineStore`, `WaitFor`, `UniversalStore`, `StoreDefinition`)
- `src/adapter.ts` — adapter interface types (`Adapter`, `NativeStoreFactory`, `NativeStoreDefinitionFactory`)
- `src/adapters/zustand.ts` — Zustand adapter (`defineZustandIsoStore`)
- `src/StoreProvider.tsx` — generic context Provider component
- `src/examples/` — example stores and components

### Architecture

Two-layer factory pattern:
- **Outer layer** (library): `(opts, waitFor) => NativeStoreDefinition` — receives opts and waitFor, returns a native store definition
- **Inner layer** (framework): e.g. `(set, get) => State` for Zustand — the native store creator

```ts
// Zustand example (MyStore2.ts)
defineZustandIsoStore<MyOpts, MyState>(
  ({ userId }, waitFor) => (       // outer: opts + waitFor
    (set, get) => ({               // inner: Zustand StateCreator
      ...waitFor('name', fetchName(userId), ''),
      setName: (name) => set({ name }),
    })
  )
);

// Server-side usage
const store = MyStore.createStore({ userId: 1 });
// <RootElement when={() => store.ready}>
//   <MyStore.StoreProvider instance={store}>
//     <Widget />
//   </MyStore.StoreProvider>
// </RootElement>

// In server-rendered components
const name = MyStore.useStore(s => s.name);

// Client-only components
const { ready, useClientStore } = MyStore.useCreateClientStore({ userId: 1 });
const name = useClientStore(s => s.name); // null until ready
```

### Design decisions
- `waitFor(key, promise, initialValue)` — returns `{ key: initialValue }` to spread into state, registers promise; `setState` is called after native store is created (avoids chicken-and-egg)
- `ready: Promise<void>` resolves when all `waitFor` promises complete
- Core has no dependency on any SSR or store framework — integration is at the call site
- `Adapter<NativeStore>` is a single generic function `<State>(nativeStore) => UniversalStore<State>`
- `uStore` on `StoreInstance` should eventually be made private via symbol key
- Names are mostly placeholders — `uStore`, `NativeStoreDefinitionFactory` etc. to be revised

### Open questions
- Client-side re-fetching / "going pending again" — not yet designed
- Export API: hooks on `StoreDefinition` object vs named exports from store modules
- Naming: `factory` vs `init` are too similar; `storeFactory`/`stateCreator` may be clearer
- Whether to offer a flattened single-lambda API for ergonomics alongside the two-layer version

---

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
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

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.
