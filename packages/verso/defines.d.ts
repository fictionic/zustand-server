declare var IS_SERVER: boolean;
declare var IS_DEV: boolean;

interface VersoNavigationGlobal {
  waitForIdle: () => Promise<void>;
  waitForNextIdle: () => Promise<void>;
}

interface Window {
  /**
   * A handle for Verso's client navigation manager.
   */
  __versoNavigation: VersoNavigationGlobal;
};
