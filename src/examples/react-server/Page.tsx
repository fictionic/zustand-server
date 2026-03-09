import UserStore from './UserStore';
import {StoreRoot} from './StoreRoot';
import UserWidget from './UserWidget';
import NotificationsWidget from './NotificationsWidget';
import Header from './Header';
import RootElement from './RootElement';

// Server-side entry point (e.g. react-server's getElements / handleRoute).
// Each RootElement streams independently — the header and notifications render
// immediately while the UserStore root waits for whenReady.
function getElements() {
  const userStore = UserStore.createStore({ userId: 1 });
  return [
    // Header is in its own root with no UserStore context.
    // It communicates with UserStore via broadcast().
    <RootElement>
      <Header />
    </RootElement>,

    // Blocks streaming until userStore.whenReady resolves.
    <StoreRoot StoreProvider={UserStore.StoreProvider} instance={userStore}>
      <UserWidget />
    </StoreRoot>,

    // NotificationsWidget creates its own store on the client — no SSR needed.
    <RootElement>
      <NotificationsWidget />
    </RootElement>,
  ];
}
