declare var IS_SERVER: boolean;
declare var IS_DEV: boolean;

interface Window {
  __waitForVersoNavigation: () => (Promise<void> | null),
};
