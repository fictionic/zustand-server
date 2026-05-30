// Vendored from @hattip/compose@0.0.49 (src/index.ts).
// Upstream: github.com/hattipjs/hattip @ 15aa5ae4d
// Local changes: rewrote import "@hattip/core" → "./core"; reformatted to 2-space indent;
//                removed legacy composeOld/composePartialOld/wrap helpers;
//                factored bootstrap() out of compose() body.
// MIT © Fatih Aygün — see ./LICENSE.

import type {AdapterRequestContext, HattipHandler} from "./core";

export interface RequestContextExtensions {}

/** App-local stuff */
export interface Locals {}

/**
 * Request context
 */
export interface RequestContext<P = unknown> extends AdapterRequestContext<P>, RequestContextExtensions {
  /** Parsed request URL */
  url: URL;
  /** Request method */
  method: string;
  /** App-local stuff */
  locals: Locals;
  /** Call the next handler in the chain */
  next(): Promise<Response>;
  /** Redefine to handle errors by generating a response from an error */
  handleError(error: unknown): Response | Promise<Response>;
}

export interface ResponseConvertible {
  toResponse(): Response | Promise<Response>;
}

export type ResponseLike = Response | ResponseConvertible;

export type MaybeResponse = ResponseLike | void;

export type MaybeAsyncResponse = MaybeResponse | Promise<MaybeResponse>;

export type RequestHandler<P = unknown> = (
  context: RequestContext<P>,
) => MaybeAsyncResponse;

export type MaybeRequestHandler<P = unknown> = |
  false |
  null |
  undefined |
  RequestHandler<P>;

export type RequestHandlerStack<P = unknown> = |
  MaybeRequestHandler<P> |
  MaybeRequestHandler<P>[];

export type PartialHandler<P = unknown> = (
  context: RequestContext<P>,
) => Response | void | Promise<Response | void>;

export function compose<P = unknown>(
  ...handlers: RequestHandlerStack<P>[]
): HattipHandler<P> {
  const composed = composePartial<P>([...handlers, finalHandler]);
  return (ctx) => composed(bootstrap(ctx));
}

function finalHandler(context: RequestContext): Response {
  context.passThrough();
  return new Response("Not found", { status: 404 });
}

function bootstrap<P>(ctx: AdapterRequestContext<P>): RequestContext<P> {
  const rich = ctx as RequestContext<P>;
  rich.url = new URL(ctx.request.url);
  rich.method = ctx.request.method;
  rich.locals = {};
  rich.handleError = (error: unknown) => {
    console.error(error);
    return new Response("Internal Server Error", { status: 500 });
  };
  return rich;
}

function composePartial<P = unknown>(
  handlers: RequestHandlerStack<P>[],
): (ctx: RequestContext<P>) => Promise<Response> {
  const flatHandlers = handlers.flat().filter(Boolean) as RequestHandler[];

  async function call(ctx: RequestContext<P>, start = 0): Promise<Response> {
    const next = ctx.next;

    let ref = 0;
    ctx.next = () => call(ctx, ref + 1);

    for (let i = start; i < flatHandlers.length; i++) {
      const handler = flatHandlers[i]!;
      ref = i;

      try {
        let response = handler(ctx);
        if (response instanceof Promise) {
          response = await response;
        }

        if (response) {
          return toResponse(response);
        }
      } catch (error) {
        if (error instanceof Response) {
          return error;
        }

        if (isResponseConvertible(error)) {
          return error.toResponse();
        }

        if (ctx.handleError) {
          return ctx.handleError(error);
        }

        throw error;
      }
    }

    return next();
  }

  return (ctx) => call(ctx);
}

function toResponse(responseLike: ResponseLike): Response | Promise<Response> {
  if (responseLike instanceof Response) {
    return Promise.resolve(responseLike);
  }

  return responseLike.toResponse();
}

function isResponseConvertible(response: any): response is ResponseConvertible {
  return response && "toResponse" in response;
}
