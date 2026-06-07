import { inject } from 'vitest';

// IS_DEV is a runtime global (not a build-time define) so devOnly() can flip it
// per-test. Default it to false.
globalThis.IS_DEV = false;

// IS_SERVER is a runtime global derived from the pass (like IS_DEV), not a
// build-time define — that's what lets testHydration() flip it across phases.
// The pass comes from each project's `provide` in versoProjects().
globalThis.IS_SERVER = inject('versoPass') === 'server';

// Let React's act() (used by testHydration) flush without warning that the
// environment is "not configured to support act".
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
