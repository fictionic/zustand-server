// Integration harness for Suite 1 (`runApp`).
//
// `runApp` is a hattip `RequestHandler` that turns a `Resolution` into a
// `Response`. This harness drives it end-to-end the same way `composeServer`
// does — composing it with the default hattip error/404 handling, building a
// real `Resolver` and `MiddlewareConfig`, and running inside `runWithServerRLS`
// — but without the public-request / bundle-serving / failsafe layers (each of
// those has its own suite). Mock only at boundaries (e.g. native `fetch`).
//
// Suite 1 runs in the **server** pass; do not switch the pass to jsdom. `jsdom`
// is used here purely as an HTML parser library (`parseHtml`), not as the test
// environment.

import {JSDOM} from "jsdom";
import {compose} from "../../vendor/hattip/compose";
import type {AdapterRequestContext} from "../../vendor/hattip/core";
import {runApp} from "../../core/server/runApp";
import {Resolver} from "../../core/common/resolver";
import {runWithServerRLS} from "../../core/common/RequestLocalStorage";
import {fillServerSettings, type RoutesMap, type ServerSettings} from "../../build/config";
import type {MiddlewareDefinition} from "../../core/common/handler/Middleware";
import type {RouteHandlerDefinition, RouteHandlerType} from "../../core/common/handler/RouteHandler";
import type {ClientManifest, Serve} from "@verso-js/contract";

export type AnyHandlerDefinition = RouteHandlerDefinition<RouteHandlerType, any, any>;

/**
 * A handler argument is either:
 *  - a single `definePage` / `defineEndpoint` result — returned for **every**
 *    route name (single-route convenience), or
 *  - a `{ routeName: definition }` map — looked up by route name (the key in
 *    the `RoutesMap`), matching how `createResolver` keys `getRouteHandler`.
 */
export type HandlerArg = AnyHandlerDefinition | Record<string, AnyHandlerDefinition>;

export type RunRouteOpts = {
  globalMiddleware?: MiddlewareDefinition[];
  settings?: Partial<ServerSettings>;
  /**
   * The `Serve` used for loopback fetch() calls. Defaults to a stub that throws
   * — most tests make no loopback fetches. Inject one for tests that do.
   */
  loopback?: Serve;
  /**
   * The client build manifest. Defaults to `null` (dev — no built bundle, the
   * value `runApp` gets in `vite dev`). Pass a manifest to exercise the
   * manifest-through-pipe branch of `bootstrapClient`, which writes it to the
   * pipe under `CLIENT_MANIFEST_KEY`. (`null` skips that write entirely.)
   */
  manifest?: ClientManifest | null;
};

const throwingLoopback: Serve = async () => {
  throw new Error("[runAppHarness] loopback fetch not configured for this test");
};

function isSingleDefinition(arg: HandlerArg): arg is AnyHandlerDefinition {
  // A `RouteHandlerDefinition` carries `{ type, init, standardize }`; a map of
  // definitions does not have an `init` field at the top level.
  return typeof (arg as AnyHandlerDefinition).init === "function";
}

/**
 * Dispatch a `Request` through `runApp` and return the resulting `Response`.
 *
 * Builds a real `Resolver` (`createResolver(routes, getRouteHandler, middleware)`),
 * composes `runApp` with hattip's default error handling (a thrown directive /
 * `error` resolution surfaces as a 500 `Internal Server Error`) and 404 fallback
 * (a `not-found` resolution / passthrough yields hattip's default 404 — status
 * 404, body `Not found`; this is distinct from a resolved directive with no
 * handler attached, where `runApp` itself returns the directive's status with a
 * null body), and runs the whole thing inside `runWithServerRLS`.
 *
 * Pass a `request` whose `signal` the test controls for render-abort cases.
 */
export function runRoute(
  handler: HandlerArg,
  routes: RoutesMap,
  request: Request,
  opts: RunRouteOpts = {},
): Promise<Response> {
  const getRouteHandler = isSingleDefinition(handler)
    ? () => handler
    : (name: string) => handler[name] ?? null;

  const resolver = new Resolver(routes, getRouteHandler, opts.globalMiddleware ?? []);

  // `allowedHosts` is unused by `runApp` (it belongs to `resolvePublicRequest`,
  // which the harness omits), but `fillServerSettings` rejects an empty list.
  const settings = fillServerSettings({allowedHosts: ["localhost"], ...opts.settings});

  const composed = compose(
    runApp({
      resolver,
      manifest: opts.manifest ?? null, // null = dev (no built bundle)
      loopback: opts.loopback ?? throwingLoopback,
      settings,
    }),
  );

  return runWithServerRLS(async () => {
    const ctx: AdapterRequestContext = {
      request,
      ip: "",
      platform: {},
      env: (name) => process.env[name],
      passThrough: () => {},
      waitUntil: () => {},
    };
    return composed(ctx);
  });
}

/** Collect the full response body as a string. */
export async function responseBodyAsString(response: Response): Promise<string> {
  return await response.text();
}

/**
 * Yield decoded chunks from the response body's `ReadableStream` as they arrive.
 * Yields nothing for a null body. Use for streaming-order / pipe-placement
 * assertions.
 */
export async function* responseBodyAsChunks(response: Response): AsyncIterable<string> {
  const body = response.body;
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      if (value) yield decoder.decode(value, {stream: true});
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

export type PipeCall = {fn: string; args: unknown[]};

/**
 * Extract VersoPipe function calls from body/chunk text.
 *
 * Grammar (emitted by `ServerClientPipe`'s `callFn`):
 *
 *   <script>window.<pipeName>.fns.call('<FN_NAME>', <jsonArgs>)</script>
 *
 * where `<pipeName>` is an identifier (e.g. `__versoPipe`) and `<jsonArgs>` is a
 * JSON array produced by `JSON.stringify`, with `<`, `>`, `&` escaped to their
 * `\uXXXX` forms (which `JSON.parse` transparently decodes). The args array is
 * located by balanced-bracket matching that respects JSON strings, so a `)` or
 * `]` inside a string value (e.g. a URL) does not terminate it early.
 *
 * Returns one `{ fn, args }` per call, in document order. Calls whose args fail
 * to parse as JSON are skipped.
 */
export function findPipeCalls(text: string): PipeCall[] {
  const calls: PipeCall[] = [];
  const re = /window\.[A-Za-z0-9_$]+\.fns\.call\(\s*'([^']*)'\s*,\s*/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const fn = match[1]!;
    const json = sliceBalancedArray(text, re.lastIndex);
    if (json === null) continue;
    let args: unknown;
    try {
      args = JSON.parse(json);
    } catch {
      continue;
    }
    if (!Array.isArray(args)) continue;
    calls.push({fn, args});
  }
  return calls;
}

// Slice the balanced JSON array starting at `start` (which must point at `[`),
// tracking string state so brackets inside strings don't affect nesting depth.
function sliceBalancedArray(text: string, start: number): string | null {
  if (text[start] !== "[") return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") {
        i++; // skip the escaped character
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
    } else if (c === "[") {
      depth++;
    } else if (c === "]") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Parse an HTML string into a `Document` (jsdom, used as a parser only). */
export function parseHtml(body: string): Document {
  return new JSDOM(body).window.document;
}
