import {stopClientRLS, startClientRLS, runWithServerRLS} from "../../core/common/RequestLocalStorage";
import type {MaybePromise} from "../../util/promise";

export function withRLS<R, P extends MaybePromise<R>>(fn: () => P): P {
  if (globalThis.IS_SERVER) {
    return runWithServerRLS(fn);
  }
  startClientRLS();
  let result: P;
  try {
    result = fn();
  } catch (e) {
    stopClientRLS();
    throw e;
  }
  if (result instanceof Promise) {
    return result.finally(stopClientRLS) as P;
  }
  stopClientRLS();
  return result;
}
