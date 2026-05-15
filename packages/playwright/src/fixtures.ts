import type { Page } from '@playwright/test';

const STATE_HYDRATED = 'hydrated';

type StandardLoadState = Parameters<Page['waitForLoadState']>[0];
type LoadState = StandardLoadState | typeof STATE_HYDRATED;
type WaitForLoadStateOptions = Parameters<Page['waitForLoadState']>[1];

type StandardGotoOptions = Parameters<Page['goto']>[1];
type StandardWaitUntil = NonNullable<StandardGotoOptions>['waitUntil'];
type PatchedWaitUntil = StandardWaitUntil | typeof STATE_HYDRATED;
type PatchedGotoOptions = Omit<StandardGotoOptions, 'waitUntil'> & {
  waitUntil?: PatchedWaitUntil;
};

export const versoFixtures = {
  page: async ({ page }: { page: Page }, use: (page: Page) => Promise<void>) => {
    const realWaitForLoadState = page.waitForLoadState.bind(page);
    const patchedWaitForLoadState = async (state: LoadState = STATE_HYDRATED, options?: WaitForLoadStateOptions) => {
      if (state === STATE_HYDRATED) {
        await realWaitForLoadState('domcontentloaded', options);
        await page.waitForFunction(() => !!window.__waitForVersoNavigation);
        await page.evaluate(async () => await window.__waitForVersoNavigation());
      } else {
        await realWaitForLoadState(state, options);
      }
    };
    page.waitForLoadState = patchedWaitForLoadState;

    const realGoto = page.goto.bind(page);
    page.goto = async (url: string, options?: PatchedGotoOptions) => {
      const waitUntil = options?.waitUntil ?? STATE_HYDRATED;
      const response = await realGoto(url, {
        ...options,
        waitUntil: waitUntil === STATE_HYDRATED ? 'commit' : waitUntil,
      });
      if (waitUntil === STATE_HYDRATED) {
        await patchedWaitForLoadState(STATE_HYDRATED);
      }
      return response;
    };

    await use(page);
  },
};
