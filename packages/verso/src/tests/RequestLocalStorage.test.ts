import { afterEach, describe, expect, test } from 'vitest';
import { getRLS, resetClientRequest, startClientRequest, startRequest } from '../core/common/RequestLocalStorage';
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
      startRequest(() => {
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
        startRequest(async () => {
          RLS().value = 'A';
          await Promise.resolve();
          return RLS().value;
        }),
        startRequest(async () => {
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
      resetClientRequest();
    });

    test('startClientRequest initializes the store; getRLS() works inside', () => {
      const RLS = getRLS<{ value: string }>();
      expect(() => RLS()).toThrow('RLS() access outside of request!');

      startClientRequest();
      RLS().value = 'hello';
      expect(RLS().value).toBe('hello');
    });

    test('resetClientRequest tears down the store; getRLS() throws after', () => {
      const RLS = getRLS<{ value: string }>();
      startClientRequest();
      RLS().value = 'test';

      resetClientRequest();
      expect(() => RLS()).toThrow('RLS() access outside of request!');
    });

    test('startClientRequest creates a fresh store each time', () => {
      const RLS = getRLS<{ value?: string }>();
      startClientRequest();
      RLS().value = 'first';
      resetClientRequest();

      startClientRequest();
      expect(RLS().value).toBeUndefined();
    });
  });
});
