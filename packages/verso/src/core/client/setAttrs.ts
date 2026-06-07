import {type RenderableHTMLAttributes} from "../common/components/attrs";
import {PAGE_ELEMENT_TOKEN_IDX_ATTR, PAGE_ROOT_ELEMENT_ATTR} from "../common/constants";

export function setRootAttrs(element: HTMLElement, attrs: RenderableHTMLAttributes, index: number) {
  clearAttrs(element);
  setRenderableAttrs(element, attrs);
  element.setAttribute(PAGE_ELEMENT_TOKEN_IDX_ATTR, String(index));
  element.setAttribute(PAGE_ROOT_ELEMENT_ATTR, '');
}

export function setContainerAttrs(element: HTMLElement, attrs: RenderableHTMLAttributes, index: number) {
  clearAttrs(element);
  setRenderableAttrs(element, attrs);
  element.setAttribute(PAGE_ELEMENT_TOKEN_IDX_ATTR, String(index));
}

function clearAttrs(element: HTMLElement) {
  for (const name of element.getAttributeNames()) {
    element.removeAttribute(name);
  }
}

const PROP_MAPPINGS: Record<string, string> = {
  'className': 'class',
  'tabIndex': 'tabindex',
};

function setRenderableAttrs(element: HTMLElement, attrs: RenderableHTMLAttributes) {
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'style' && typeof value === 'object') {
      setStyles(element, value as Record<string, unknown>);
      continue;
    }
    const attrName = PROP_MAPPINGS[key] ?? key;
    element.setAttribute(attrName, value === true ? '' : String(value));
  }
}

/**
 * Applies a React-style style object to a DOM element, matching the unit
 * handling that react-dom uses when serializing styles during SSR. This keeps
 * client-side transitions consistent with the server-rendered style attribute
 * (e.g. a numeric `maxWidth: 960` becomes `960px`, not the bare, invalid `960`).
 *
 * Mirrors `setValueForStyle` / `isUnitlessNumber` from react-dom-bindings
 * (pinned to react-dom 19.2.x — re-sync if that internal changes on upgrade).
 */
function setStyles(element: HTMLElement, styles: Record<string, unknown>) {
  const style = element.style as CSSStyleDeclaration & Record<string, string>;
  for (const [name, value] of Object.entries(styles)) {
    const isCustomProperty = name.startsWith('--');
    if (value == null || typeof value === 'boolean' || value === '') {
      if (isCustomProperty) style.setProperty(name, '');
      else style[name === 'float' ? 'cssFloat' : name] = '';
    } else if (isCustomProperty) {
      style.setProperty(name, String(value));
    } else if (typeof value === 'number' && value !== 0 && !UNITLESS_NUMBERS.has(name)) {
      // presumes an implicit 'px' suffix for unitful numeric values
      style[name] = `${value}px`;
    } else {
      style[name === 'float' ? 'cssFloat' : name] = String(value).trim();
    }
  }
}

/**
 * CSS properties which accept numbers but are not in units of "px".
 * Copied verbatim from react-dom-bindings' `isUnitlessNumber` (react-dom
 * 19.2.x) so that our client-side style application matches react-dom's SSR
 * serialization exactly. Re-sync this set if react-dom is upgraded.
 */
const UNITLESS_NUMBERS = new Set([
  'animationIterationCount',
  'aspectRatio',
  'borderImageOutset',
  'borderImageSlice',
  'borderImageWidth',
  'boxFlex',
  'boxFlexGroup',
  'boxOrdinalGroup',
  'columnCount',
  'columns',
  'flex',
  'flexGrow',
  'flexPositive',
  'flexShrink',
  'flexNegative',
  'flexOrder',
  'gridArea',
  'gridRow',
  'gridRowEnd',
  'gridRowSpan',
  'gridRowStart',
  'gridColumn',
  'gridColumnEnd',
  'gridColumnSpan',
  'gridColumnStart',
  'fontWeight',
  'lineClamp',
  'lineHeight',
  'opacity',
  'order',
  'orphans',
  'scale',
  'tabSize',
  'widows',
  'zIndex',
  'zoom',
  'fillOpacity', // SVG-related properties
  'floodOpacity',
  'stopOpacity',
  'strokeDasharray',
  'strokeDashoffset',
  'strokeMiterlimit',
  'strokeOpacity',
  'strokeWidth',
  'MozAnimationIterationCount', // Known Prefixed Properties
  'MozBoxFlex',
  'MozBoxFlexGroup',
  'MozLineClamp',
  'msAnimationIterationCount',
  'msFlex',
  'msZoom',
  'msFlexGrow',
  'msFlexNegative',
  'msFlexOrder',
  'msFlexPositive',
  'msFlexShrink',
  'msGridColumn',
  'msGridColumnSpan',
  'msGridRow',
  'msGridRowSpan',
  'WebkitAnimationIterationCount',
  'WebkitBoxFlex',
  'WebKitBoxFlexGroup',
  'WebkitBoxOrdinalGroup',
  'WebkitColumnCount',
  'WebkitColumns',
  'WebkitFlex',
  'WebkitFlexGrow',
  'WebkitFlexPositive',
  'WebkitFlexShrink',
  'WebkitLineClamp',
]);
