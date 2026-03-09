import UserStore from './UserStore';

// Consumes the server-rendered UserStore via context.
// Selects granularly — only re-renders when the selected slice changes.
export default function UserWidget() {
  const name = UserStore.useStore(s => s.name);
  const note = UserStore.useStore(s => s.note);
  const rename = UserStore.useStore(s => s.rename);
  const clearNote = UserStore.useStore(s => s.clearNote);
  return (
    <div>
      <p>{name}: {note}</p>
      <button onClick={() => rename('Bob')}>Rename to Bob</button>
      <button onClick={clearNote}>Clear note</button>
    </div>
  );
}
