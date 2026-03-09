import NotificationsStore from './NotificationsStore';

// Client-only component: creates its own store instance on mount.
// useClientStore returns null until the store is ready.
export default function NotificationsWidget() {
  const { ready, useClientStore } = NotificationsStore.useCreateClientStore({});
  const count = useClientStore(s => s.count);
  const increment = useClientStore(s => s.increment);
  if (!ready) return null;
  return (
    <button onClick={increment!}>{count} notifications</button>
  );
}
