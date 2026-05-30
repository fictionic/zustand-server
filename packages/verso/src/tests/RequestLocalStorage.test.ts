import { afterEach, describe, expect, test } from 'vitest';
import { getRLS, stopClientRLS, startClientRLS, runWithServerRLS } from '../core/common/RequestLocalStorage';
import { clientSide, serverSide } from '../userland/testing/isomorphic';

describe('RequestLocalStorage', () => {
  test('RLS.foo (without calling) throws helpful error', () => {
    const RLS = getRLS<{ foo: string }>();
    expect(() => {
      void (RLS as unknown as Record<string, unknown>).foo;
    }).toThrow('Use of RLS.foo should be RLS().foo!');
  });

  serverSide(() => {
    test('startRequest runs callback in ALS context; getRLS() works inside', () => {
      const RLS = getRLS<{ count: number }>();
      runWithServerRLS(() => {
        RLS().count = 42;
        expect(RLS().count).toBe(42);
      });
    });

    test('getRLS() outside request throws', () => {
      const RLS = getRLS<Record<string, never>>();
      expect(() => RLS()).toThrow('RLS() access outside of request!');
    });

    test('two concurrent requests have independent stores', async () => {
      const RLS = getRLS<{ value: string }>();

      const [val1, val2] = await Promise.all([
        runWithServerRLS(async () => {
          RLS().value = 'A';
          await Promise.resolve();
          return RLS().value;
        }),
        runWithServerRLS(async () => {
          RLS().value = 'B';
          await Promise.resolve();
          return RLS().value;
        }),
      ]);

      expect(val1).toBe('A');
      expect(val2).toBe('B');
    });
  });

  clientSide(() => {
    afterEach(() => {
      stopClientRLS();
    });

    test('startClientRequest initializes the store; getRLS() works inside', () => {
      const RLS = getRLS<{ value: string }>();
      expect(() => RLS()).toThrow('RLS() access outside of request!');

      startClientRLS();
      RLS().value = 'hello';
      expect(RLS().value).toBe('hello');
    });

    test('resetClientRequest tears down the store; getRLS() throws after', () => {
      const RLS = getRLS<{ value: string }>();
      startClientRLS();
      RLS().value = 'test';

      stopClientRLS();
      expect(() => RLS()).toThrow('RLS() access outside of request!');
    });

    test('startClientRequest creates a fresh store each time', () => {
      const RLS = getRLS<{ value?: string }>();
      startClientRLS();
      RLS().value = 'first';
      stopClientRLS();

      startClientRLS();
      expect(RLS().value).toBeUndefined();
    });
  });
});
