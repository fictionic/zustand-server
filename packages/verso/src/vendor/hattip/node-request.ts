// Vendored from @hattip/adapter-node@0.0.49 (src/request.ts).
// Upstream: github.com/hattipjs/hattip @ 15aa5ae4d
// Stripped: Deno branch, rawBody handling, origin/ORIGIN env, trustProxy +
//           X-Forwarded-* handling, IP extraction, createRequestAdapter
//           closure shape, NodeRequestAdapterOptions, parseForwardedHeader,
//           `warned` flag.
// Local changes: encryption check via TLSSocket instanceof; flattened the
//                exported API from createRequestAdapter(opts)(req, res) to plain
//                toWebRequest(req, res).
// MIT © Fatih Aygün — see ./LICENSE.

/* eslint-disable @typescript-eslint/ban-ts-comment */
import type { IncomingMessage, ServerResponse } from "node:http";
import { TLSSocket } from "node:tls";

/** Convert a Node HTTP request into a fetch API `Request` object */
export function toWebRequest(req: IncomingMessage, res: ServerResponse): Request {
	let headers = req.headers as any;

	const encrypted = req.socket instanceof TLSSocket && req.socket.encrypted;
	const protocol =
		headers[":scheme"] ||
		(encrypted && "https") ||
		"http";

	const host = headers[":authority"] || headers.host || "localhost";

	// Filter out HTTP/2 pseudo-headers
	if (headers[":method"]) {
		headers = Object.fromEntries(
			Object.entries(headers).filter(([key]) => !key.startsWith(":")),
		);
	}

	const controller = new AbortController();
	req.once("close", () => {
		if (!res.writableEnded) {
			controller.abort();
		}
	});

	return new Request(protocol + "://" + host + req.url, {
		method: req.method,
		headers,
		body: convertBody(req),
		signal: controller.signal,
		// @ts-expect-error: Node requires this when the body is a ReadableStream
		duplex: "half",
	});
}

function convertBody(req: IncomingMessage): BodyInit | null | undefined {
	if (req.method === "GET" || req.method === "HEAD") {
		return;
	}
	// Node and Bun can handle Readable directly as request body
	return req as any;
}
