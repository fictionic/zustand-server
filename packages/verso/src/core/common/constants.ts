export const PAGE_HEADER_STYLE_ELEMENT_ATTR = 'data-verso-style-element';
export const PAGE_HEADER_LINK_ELEMENT_ATTR = 'data-verso-link-element';
export const PAGE_HEADER_SCRIPT_ELEMENT_ATTR = 'data-verso-script-element';
export const PAGE_ROOT_ELEMENT_ATTR = 'data-verso-root';
export const PAGE_ELEMENT_TOKEN_IDX_ATTR = 'data-verso-element-token-idx';

// hopefully-unique url prefix for verso-internal routes
export const VERSO_INTERNAL_URL_PREFIX = '/__verso';

// dev-only endpoint: returns the CSS stylesheet list for a named route, so the
// client can transition stylesheets during programmatic navigation the same way
// it does in prod (from the bundle manifest)
export const DEV_ROUTE_CSS_PATH = VERSO_INTERNAL_URL_PREFIX + '/route-css';

// this is the attribute that vite uses to track styles for HMR.
// ideally we wouldn't have to redefine it ourselves... TODO
export const DEV_VITE_STYLE_ID_ATTR = 'data-vite-dev-id';

// max depth for recursively resolving routes / clientside redirects
export const MAX_RECURSIVE_DEPTH = 10;
