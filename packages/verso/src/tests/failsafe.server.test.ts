import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleFailsafeTimeouts } from '../core/server/failsafe';
import type { ServerSettings } from '../build/config';
import type { RequestContext } from '../vendor/hattip/compose';

function makeRequest(signal?: AbortSignal): Request {
  return new Request('http://localhost/', signal ? { signal } : {});
}

function makeCtx(request: Request, next: () => Promise<Response>): RequestContext {
  return {
    request,
    next,
    ip: '127.0.0.1',
    platform: undefined,
    env: () => undefined,
    passThrough: () => {},
    waitUntil: () => {},
    url: new URL('http://localhost/'),
    method: 'GET',
    locals: {},
    handleError: () => new Response('error', { status: 500 }),
  };
}

function makeSettings(ttfb: number, response: number): ServerSettings {
  return {
    allowedHosts: ['localhost'],
    trustProxy: false,
    fetchOrigin: 'request-host',
    failsafeTtfbDeadlineMs: ttfb,
    failsafeResponseDeadlineMs: response,
  };
}

describe('handleFailsafeTimeouts', () => {
  describe('TTFB deadline (fake timers)', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    test('next() resolves before TTFB deadline → that Response is returned (not 504)', async () => {
      const next = vi.fn().mockResolvedValue(new Response('ok'));
      const handler = handleFailsafeTimeouts(makeSettings(1000, 5000));
      const ctx = makeCtx(makeRequest(), next);

      const resultPromise = handler(ctx) as Promise<Response>;
      await vi.advanceTimersByTimeAsync(100); // well before 1000ms deadline
      const result = await resultPromise;

      expect(result.status).toBe(200);
    });

    test('next() stays pending past TTFB deadline → 504 with body "Failsafe timeout"', async () => {
      const next = vi.fn().mockReturnValue(new Promise<Response>(() => {})); // never resolves
      const handler = handleFailsafeTimeouts(makeSettings(500, 5000));
      const ctx = makeCtx(makeRequest(), next);

      const resultPromise = handler(ctx) as Promise<Response>;
      await vi.advanceTimersByTimeAsync(501);
      const result = await resultPromise;

      expect(result.status).toBe(504);
      expect(await result.text()).toBe('Failsafe timeout');
    });

    test('fast response clears the TTFB timer → no 504 after advancing past deadline', async () => {
      const next = vi.fn().mockResolvedValue(new Response('fast'));
      const handler = handleFailsafeTimeouts(makeSettings(500, 5000));
      const ctx = makeCtx(makeRequest(), next);

      const resultPromise = handler(ctx) as Promise<Response>;
      // Let next() resolve (microtask); handler should settle before the deadline
      await vi.advanceTimersByTimeAsync(1);
      const result = await resultPromise;

      // Advance well past the TTFB deadline — timer was cleared, so no 504
      await vi.advanceTimersByTimeAsync(1000);

      expect(result.status).toBe(200);
    });
  });

  describe('Signal merging', () => {
    test('ctx.request.signal is a different signal than the original after calling the handler', () => {
      const upstream = new AbortController();
      const request = makeRequest(upstream.signal);
      const originalSignal = request.signal;
      const next = vi.fn().mockResolvedValue(new Response('ok'));
      const handler = handleFailsafeTimeouts(makeSettings(5000, 5000));
      const ctx = makeCtx(request, next);

      // async fn runs sync code before its first await, so ctx.request is updated
      // synchronously before handler() returns its Promise
      void (handler(ctx) as Promise<Response>);

      expect(ctx.request.signal).not.toBe(originalSignal);

      upstream.abort(); // abort to clean up background timers quickly
    });

    test('aborting the upstream signal aborts the merged signal downstream receives', () => {
      const upstream = new AbortController();
      const request = makeRequest(upstream.signal);
      const next = vi.fn().mockResolvedValue(new Response('ok'));
      const handler = handleFailsafeTimeouts(makeSettings(5000, 5000));
      const ctx = makeCtx(request, next);

      void (handler(ctx) as Promise<Response>);
      const mergedSignal = ctx.request.signal;

      expect(mergedSignal.aborted).toBe(false);
      upstream.abort();
      // AbortSignal.any propagates synchronously
      expect(mergedSignal.aborted).toBe(true);
    });

    test('failsafe response-deadline firing aborts the merged signal', async () => {
      // Real timers; tiny deadline so the test stays fast
      const stalled = new ReadableStream<Uint8Array>({ start() {} }); // never enqueues or closes
      const next = vi.fn().mockResolvedValue(new Response(stalled));
      const handler = handleFailsafeTimeouts(makeSettings(5000, 20));
      const ctx = makeCtx(makeRequest(), next);

      void (handler(ctx) as Promise<Response>);
      const mergedSignal = ctx.request.signal;

      expect(mergedSignal.aborted).toBe(false);

      // Wait longer than the 20ms response deadline
      await new Promise<void>(resolve => setTimeout(resolve, 40));

      expect(mergedSignal.aborted).toBe(true);
    });
  });

  describe('Response-stream deadline (real timers)', () => {
    test('body finishes streaming before deadline → passes through unchanged; signal not aborted', async () => {
      const encoder = new TextEncoder();
      let ctrl!: ReadableStreamDefaultController<Uint8Array>;
      const readable = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; } });
      const next = vi.fn().mockResolvedValue(new Response(readable, { status: 200 }));
      const handler = handleFailsafeTimeouts(makeSettings(5000, 100));
      const ctx = makeCtx(makeRequest(), next);

      const result = await (handler(ctx) as Promise<Response>);

      // Complete the body well before the 100ms deadline
      ctrl.enqueue(encoder.encode('complete'));
      ctrl.close();

      const text = await result.text();
      expect(text).toBe('complete');

      // Wait past the deadline; the timer was cleared on pipe completion
      await new Promise<void>(resolve => setTimeout(resolve, 150));
      expect(ctx.request.signal.aborted).toBe(false);
    });

    test('body stalls past response deadline → failsafe controller aborts; merged signal is aborted', async () => {
      // Real timers; tiny deadline
      const encoder = new TextEncoder();
      const readable = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(encoder.encode('partial'));
          // Never closes — intentionally stalls
        },
      });
      const next = vi.fn().mockResolvedValue(new Response(readable, { status: 200 }));
      const handler = handleFailsafeTimeouts(makeSettings(5000, 20));
      const ctx = makeCtx(makeRequest(), next);

      const result = await (handler(ctx) as Promise<Response>);
      const mergedSignal = ctx.request.signal;

      const reader = result.body!.getReader();
      const { value } = await reader.read();
      expect(value).toBeDefined(); // received the partial chunk

      // Wait for response deadline to fire
      await new Promise<void>(resolve => setTimeout(resolve, 40));

      expect(mergedSignal.aborted).toBe(true);

      reader.cancel().catch(() => {});
    });

    test('response with no body (204) → deadline timer cleared immediately; signal not aborted', async () => {
      const next = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
      const handler = handleFailsafeTimeouts(makeSettings(5000, 20));
      const ctx = makeCtx(makeRequest(), next);

      const result = await (handler(ctx) as Promise<Response>);
      expect(result.status).toBe(204);

      // Wait past the 20ms deadline; timer was cleared because body was null
      await new Promise<void>(resolve => setTimeout(resolve, 40));
      expect(ctx.request.signal.aborted).toBe(false);
    });
  });

  describe('Write-after-abort guard', () => {
    test('upstream signal aborts mid-stream → piping stops; awaiting the handler does not reject', async () => {
      const upstream = new AbortController();
      const encoder = new TextEncoder();
      let ctrl!: ReadableStreamDefaultController<Uint8Array>;
      const readable = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; } });
      const next = vi.fn().mockResolvedValue(new Response(readable, { status: 200 }));
      const handler = handleFailsafeTimeouts(makeSettings(5000, 5000));
      const ctx = makeCtx(makeRequest(upstream.signal), next);

      const resultPromise = handler(ctx) as Promise<Response>;
      // Handler promise resolves normally (does not reject from abort)
      const result = await resultPromise;
      await expect(resultPromise).resolves.toBeDefined();

      const reader = result.body!.getReader();

      // Send first chunk
      ctrl.enqueue(encoder.encode('chunk1'));
      const { value: chunk1 } = await reader.read();
      expect(chunk1).toBeDefined();

      // Abort upstream mid-stream; pipeTo (signal: upstreamSignal) aborts,
      // erroring ts.writable (preventCancel keeps res.body alive)
      upstream.abort();

      // The consumer sees truncation: ts.readable closes/errors, not the full body
      const truncated = await Promise.race([
        reader.read().then(r => ({ done: r.done, errored: false })).catch(() => ({ done: false, errored: true })),
        new Promise<{ timeout: true }>(resolve => setTimeout(() => resolve({ timeout: true }), 200)),
      ]);
      // Either stream errors or closes — either way, the consumer doesn't get more data
      expect('timeout' in truncated ? false : true).toBe(true);

      reader.cancel().catch(() => {});
    });
  });
});
