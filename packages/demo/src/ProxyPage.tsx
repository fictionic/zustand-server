import { definePage } from '@verso-js/verso';

// Manual-test fixture for the proxy directive: this route renders nothing of
// its own — it proxies DemoPage, so hitting /proxy should serve the DemoPage
// document while the URL stays at /proxy (no redirect).
export default definePage(() => ({
  getRouteDirective() {
    return { kind: 'proxy', routeName: 'DemoPage' };
  },

  // never called — the proxied route (DemoPage) renders. Required by the page
  // contract for now (see PageRequiredMethods TODO).
  getElements() {
    return [];
  },
}));
