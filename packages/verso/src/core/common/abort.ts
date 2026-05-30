import {getRLS} from "../common/RequestLocalStorage";

const RLS = getRLS<{
  signal: AbortSignal;
  promise: Promise<never>;
}>();

export function initAbort(signal: AbortSignal) {
  RLS().signal = signal;
  const promise = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason));
  });
  promise.catch(() => {}); // prevent UnhandledPromiseRejection
  RLS().promise = promise;
}

export function getAbortSignal() {
  return RLS().signal;
}

export function getAbortPromise() {
  return RLS().promise;
}

export function didAbort(): boolean {
  return RLS().signal.aborted;
}
