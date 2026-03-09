import UserStore from './UserStore';

// Rendered in a separate root from UserWidget — no UserStore.StoreProvider above it.
// Uses broadcast() to send a message to all mounted UserStore instances.
export default function Header() {
  return (
    <header>
      <button onClick={() => UserStore.broadcast({ type: 'clearNote' })}>
        Clear note
      </button>
    </header>
  );
}
