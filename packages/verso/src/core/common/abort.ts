import {getRLS} from "../common/RequestLocalStorage";

const RLS = getRLS<{
  controller: AbortController,
  promise: Promise<never>,
  timeoutId: NodeJS.Timeout | undefined;
}>();

export function initAbortController(parent?: AbortSignal): AbortController {
  const controller = parent ? chainedController(parent) : new AbortController();
  const promise = new Promise<never>((_, reject) => {
    const doReject = () => reject(controller.signal.reason);
    if (controller.signal.aborted) {
      doReject();
    } else {
      controller.signal.addEventListener(
        'abort',
        doReject,
        { once: true },
      );
    }
  });
  RLS().controller = controller;
  RLS().promise = promise;
  return controller;
}

export function getAbortSignal(): AbortSignal {
  return RLS().controller.signal;
}

export function getAbortPromise(): Promise<never> {
  return RLS().promise;
}

export function didAbort(): boolean {
  return RLS().controller.signal.aborted;
}

export function startAbortTimeout(reason: any, timeoutMs: number): void {
  const timeoutId = RLS().timeoutId;
  if (timeoutId) throw new Error('already an active abort timeout!');
  RLS().timeoutId = setTimeout(() => {
    RLS().controller.abort(reason);
  }, timeoutMs);
}

export function cancelAbortTimeout(): void {
  const timeoutId = RLS().timeoutId;
  if (timeoutId) {
    clearTimeout(timeoutId);
    RLS().timeoutId = undefined;
  }
}

function chainedController(parent: AbortSignal): AbortController {
  const controller = new AbortController();
  if (parent.aborted) {
    controller.abort(parent.reason);
    return controller;
  }
  parent.addEventListener(
    'abort',
    () => controller.abort(parent.reason),
    { once: true, signal: controller.signal },
  );
  return controller;
}
