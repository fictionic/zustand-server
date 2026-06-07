import { inject } from 'vitest';

export type TestPass = 'server' | 'client' | 'hydration';

declare module 'vitest' {
  interface ProvidedContext {
    versoPass: TestPass;
  }
}

/**
 * The current test pass, read live from the per-project `provide` set by
 * versoProjects(). IS_SERVER is derived from it in the setup file (a runtime
 * global, like IS_DEV, not a build-time define).
 */
export function getPass(): TestPass {
  const pass = inject('versoPass');
  if (pass !== 'server' && pass !== 'client' && pass !== 'hydration') {
    throw new Error(
      'Verso test pass is not set — wire up your vitest config with versoProjects() ' +
        'so the setup file can establish it.',
    );
  }
  return pass;
}
