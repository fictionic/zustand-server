import {stopClientRLS, startClientRLS, runWithServerRLS} from "../../core/common/RequestLocalStorage";
import type {MaybePromise} from "../../core/common/util/types";

export function withRLS<R, P extends MaybePromise<R>>(fn: () => P): () => P {
  if (globalThis.IS_SERVER) {
    return () => runWithServerRLS(fn);
  }
  return () => {
    startClientRLS();
    let result: P;
    try {
      result = fn();
      if (result instanceof Promise) {
        return result.finally(stopClientRLS) as P;
      }
      return result;
    } finally {
      stopClientRLS();
    }
  };
}
