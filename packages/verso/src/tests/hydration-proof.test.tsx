import { testHydration } from '../userland/testing/hydration';

// A component that reads IS_SERVER but renders the same content in both phases
// hydrates cleanly. (A component whose output depends on IS_SERVER would fail —
// that's what testHydration guards against.)
function Greeting({ name }: { name: string }) {
  const where = IS_SERVER ? 'server' : 'client';
  return (
    <section>
      <h1>Hello, {name}</h1>
      {/* same regardless of `where`, so no mismatch */}
      <p data-rendered-on={where ? 'somewhere' : 'nowhere'}>welcome</p>
    </section>
  );
}

testHydration('component with isomorphic output hydrates cleanly', () => (
  <Greeting name="world" />
));
