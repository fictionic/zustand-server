import { afterEach, beforeEach, describe } from 'vitest';

export function devOnly(fn: () => void): void {
  describe('(dev)', () => {
    beforeEach(() => {
      globalThis.IS_DEV = true;
    });
    afterEach(() => {
      globalThis.IS_DEV = false;
    });
    fn();
  });
}
