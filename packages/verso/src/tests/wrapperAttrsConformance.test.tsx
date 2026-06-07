// @vitest-environment jsdom
//
// Conformance test: the server serializes RootContainer / Root wrapper attrs to
// an HTML string via react-dom's renderToString, while the client applies the
// same attrs to a live DOM element via setContainerAttrs / setRootAttrs. These
// are two independent implementations (mirroring react-dom's own server vs.
// client-bindings split) and they must produce identical results, or a client
// transition will silently diverge from the server-rendered markup.
//
// This is what guards against drift in the hand-rolled style serializer in
// setAttrs.ts (e.g. the numeric `maxWidth: 960` -> `960px` unit handling, and
// the UNITLESS_NUMBERS table copied from react-dom). If a React upgrade shifts
// that behavior, this test fails loudly instead of shipping a layout bug that
// only appears on client navigation.

import { describe, test, expect } from 'vitest';
import type { RenderableHTMLAttributes } from '../core/common/components/attrs';
import {
  renderContainerOpenToString,
  renderRootToString,
} from '../core/server/renderElement';
import { setContainerAttrs, setRootAttrs } from '../core/client/setAttrs';

function parseHtml(html: string): HTMLElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  const el = tpl.content.firstElementChild;
  if (!(el instanceof HTMLElement)) throw new Error(`could not parse element from: ${html}`);
  return el;
}

// Normalize an element to a comparable shape. Style is compared via the CSSOM's
// cssText so both sides go through identical jsdom normalization, isolating the
// semantic style value from incidental string formatting.
function snapshot(el: HTMLElement): { attrs: Record<string, string>; style: string } {
  const attrs: Record<string, string> = {};
  for (const name of el.getAttributeNames()) {
    if (name === 'style') continue;
    attrs[name] = el.getAttribute(name)!;
  }
  return { attrs, style: el.style.cssText };
}

function serverContainer(index: number, attrs: RenderableHTMLAttributes): HTMLElement {
  // renderContainerOpenToString returns just the open tag (closing </div>
  // sliced off); re-close it so it parses into a single element.
  return parseHtml(`${renderContainerOpenToString(index, attrs)}</div>`);
}

function clientContainer(index: number, attrs: RenderableHTMLAttributes): HTMLElement {
  const el = document.createElement('div');
  setContainerAttrs(el, attrs, index);
  return el;
}

function serverRoot(index: number, attrs: RenderableHTMLAttributes): HTMLElement {
  return parseHtml(renderRootToString(index, '', attrs));
}

function clientRoot(index: number, attrs: RenderableHTMLAttributes): HTMLElement {
  const el = document.createElement('div');
  setRootAttrs(el, attrs, index);
  return el;
}

const cases: Array<{ name: string; attrs: RenderableHTMLAttributes }> = [
  {
    name: 'numeric length style (the maxWidth regression)',
    attrs: { style: { maxWidth: 960, margin: '0 auto', padding: '40px 20px' } },
  },
  {
    name: 'unitless numeric styles stay raw',
    attrs: { style: { opacity: 1, zIndex: 5, lineHeight: 1.5, flexGrow: 2 } },
  },
  {
    name: 'zero numeric value',
    attrs: { style: { marginTop: 0, width: 0 } },
  },
  {
    name: 'mixed string + numeric styles',
    attrs: { style: { display: 'grid', gap: 32, width: 280 } },
  },
  {
    name: 'className maps to class',
    attrs: { className: 'card primary', style: { padding: 8 } },
  },
  {
    name: 'id, role, and aria attributes',
    attrs: { id: 'main', role: 'region', 'aria-label': 'demo' },
  },
  {
    name: 'boolean hidden attribute',
    attrs: { hidden: true },
  },
  {
    name: 'tabIndex maps to tabindex',
    attrs: { tabIndex: 0 },
  },
  {
    name: 'data attributes (string and numeric)',
    attrs: { 'data-card': 'user', 'data-count': 5 },
  },
];

describe('wrapper attr serialization: server (renderToString) vs client (setAttrs)', () => {
  describe('container', () => {
    for (const { name, attrs } of cases) {
      test(name, () => {
        expect(snapshot(clientContainer(3, attrs))).toEqual(snapshot(serverContainer(3, attrs)));
      });
    }
  });

  describe('root', () => {
    for (const { name, attrs } of cases) {
      test(name, () => {
        expect(snapshot(clientRoot(3, attrs))).toEqual(snapshot(serverRoot(3, attrs)));
      });
    }
  });
});
