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
      Object.assign(element.style, value);
      continue;
    }
    const attrName = PROP_MAPPINGS[key] ?? key;
    element.setAttribute(attrName, value === true ? '' : String(value));
  }
}
