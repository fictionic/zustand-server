export type MaybePromise<T> = T | Promise<T>;

/**
 * Returns a promise created from attaching a no-op error handler to the input
 * promise.
 */
export async function silenced(p: Promise<void>): Promise<void> {
  return await p.catch(() => {});
}

/**
 * Attaches an error handler to a promise, to avoid unhandled-rejection errors.
 */
export function silence(p: Promise<unknown>): void {
  void silenced(p.then(() => {}));
}
