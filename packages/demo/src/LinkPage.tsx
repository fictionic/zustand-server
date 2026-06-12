import './base.css';
import './link-page.css';
import { Link, RootContainer, definePage } from '@verso-js/verso';

export default definePage(() => ({
  getTitle() {
    return 'Link Page';
  },

  getRouteDirective() {
    return { kind: 'ok' };
  },

  getElements() {
    return [
      <RootContainer style={{ maxWidth: 960, margin: '0 auto', padding: '40px 20px' }}>
        <h1 className="link-page-title">Link Page</h1>
        <Link href="/">Back to demo</Link>
      </RootContainer>,
    ];
  },
}));
