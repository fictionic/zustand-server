// Vendored from @hattip/adapter-node@0.0.49 (src/response.ts).
// Upstream: github.com/hattipjs/hattip @ 15aa5ae4d
// Stripped: Deno detection + Headers.prototype.set monkey-patch, rawBodySymbol
//           import + branch.
// Renamed: sendResponse → sendWebResponse.
// MIT © Fatih Aygün — see ./LICENSE.

import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Send a fetch API Response into a Node.js HTTP response stream.
 */
export async function sendWebResponse(
	req: IncomingMessage,
	res: ServerResponse,
	fetchResponse: Response,
): Promise<void> {
	const controller = new AbortController();
	const signal = controller.signal;

	req.once("close", () => {
		controller.abort();
	});

	res.once("close", () => {
		controller.abort();
	});

	const hasContentLength = fetchResponse.headers.has("Content-Length");

	const body = fetchResponse.body;
	if (!body) {
		if (!hasContentLength) {
			res.setHeader("Content-Length", "0");
		}
		writeHead(fetchResponse, res, req);
		res.end();
		return;
	}

	let setImmediateFired = false;
	setImmediate(() => {
		setImmediateFired = true;
	});

	const chunks: Uint8Array[] = [];
	let bufferWritten = false;
	// @ts-expect-error -- bogus error: lib.dom.d.ts's ReadableStream doesn't declare [Symbol.asyncIterator], but undici (Node's actual ReadableStream impl) supports async iteration.
	for await (const chunk of body) {
		if (signal.aborted) {
			body.cancel().catch(() => {});
			return;
		}
		if (setImmediateFired) {
			if (!bufferWritten) {
				writeHead(fetchResponse, res, req);
				for (const chunk of chunks) {
					await writeAndAwait(chunk, res, signal);
					if (signal.aborted) {
						body.cancel().catch(() => {});
						return;
					}
				}

				bufferWritten = true;
			}

			await writeAndAwait(chunk, res, signal);
			if (signal.aborted) {
				body.cancel().catch(() => {});
				return;
			}
		} else {
			chunks.push(chunk);
		}
	}

	if (signal.aborted) return;

	if (setImmediateFired) {
		res.end();
		return;
	}

	// We were able to read the whole body. Write at once.
	const buffer = Buffer.concat(chunks);

	if (!hasContentLength) {
		res.setHeader("Content-Length", buffer.length);
	}
	writeHead(fetchResponse, res, req);
	res.end(buffer);
}

function writeHead(
	fetchResponse: Response,
	nodeResponse: ServerResponse,
	nodeRequest: IncomingMessage,
) {
	nodeResponse.statusCode = fetchResponse.status;
	if (nodeRequest.httpVersionMajor === 1 && fetchResponse.statusText) {
		nodeResponse.statusMessage = fetchResponse.statusText;
	}

	const uniqueHeaderNames = new Set(fetchResponse.headers.keys());

	for (const key of uniqueHeaderNames) {
		if (key === "set-cookie") {
			const setCookie = fetchResponse.headers.getSetCookie!();
			nodeResponse.setHeader("set-cookie", setCookie);
		} else {
			nodeResponse.setHeader(key, fetchResponse.headers.get(key)!);
		}
	}
}

async function writeAndAwait(
	chunk: Uint8Array,
	res: ServerResponse,
	signal: AbortSignal,
) {
	const written = (res.write as any)(chunk);
	if (!written) {
		await new Promise<void>((resolve, reject) => {
			function cleanup() {
				res.off("drain", success);
				res.off("error", failure);
				signal.removeEventListener("abort", success);
			}

			function success() {
				cleanup();
				resolve();
			}

			function failure(reason: unknown) {
				cleanup();
				reject(reason);
			}

			res.once("drain", success);
			res.once("error", reject);
			signal.addEventListener("abort", success);
		});
	}
}
