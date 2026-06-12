import './base.css';
import './demo-page.css';
import { ProfileStore, ThemeStore, ActivityStore } from './stores';
import { RootContainer, TheFold, definePage } from '@verso-js/verso';
import { User } from './components/User';
import { Prefs } from './components/Prefs';
import { Activity } from './components/Activity';
import { Broadcast } from './components/Broadcast';
import { LatencyControls } from './components/LatencyControls';
import AuthMiddleware from './AuthMiddleware';
import {StoreRoot} from '@verso-js/stores';

export default definePage(() => {
  // TODO: export these store instance types
  let profile1!: ReturnType<typeof ProfileStore.createStore>;
  let theme1!: ReturnType<typeof ThemeStore.createStore>;
  let activity!: ReturnType<typeof ActivityStore.createStore>;
  let broadcast!: ReturnType<typeof ProfileStore.createStore>;

  return {
    middleware: [AuthMiddleware],

    getRouteDirective() {
      profile1 = ProfileStore.createStore({ userId: 1 });
      theme1 = ThemeStore.createStore({ userId: 1 });
      activity = ActivityStore.createStore({});
      broadcast = ProfileStore.createStore({ userId: 3 });
      return { kind: 'ok' };
    },

    getTitle() {
      return 'isomorphic-stores demo';
    },

    getBodyClasses() {
      return ['Demo'];
    },

    getElements() {
      return [
        <RootContainer style={{ maxWidth: 960, margin: '0 auto', padding: '40px 20px' }}>
          <div>
            <h1 className="demo-header-title">isomorphic-stores</h1>
            <p className="demo-header-subtitle">
              Framework-agnostic SSR state management. Stores are created server-side,
              async data is declared via <code>setAsync</code>, and the SSR framework blocks
              rendering until the store is ready. Roots stream in progressively; <code>TheFold</code>
              {' '}triggers client bootstrap before all roots have arrived.
            </p>
          </div>
          <RootContainer style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 32, alignItems: 'start' }}>
            <RootContainer>
              <StoreRoot stores={[profile1]}>
                <User />
              </StoreRoot>
              <StoreRoot stores={[theme1]}>
                <Prefs />
              </StoreRoot>
              <StoreRoot stores={[activity]}>
                <Activity />
              </StoreRoot>
              <TheFold />
              <StoreRoot stores={[broadcast]}>
                <Broadcast />
              </StoreRoot>
            </RootContainer>
            <RootContainer style={{ position: 'sticky', top: 24 }}>
              <LatencyControls />
            </RootContainer>
          </RootContainer>
        </RootContainer>,
      ];
    },
  };
});
