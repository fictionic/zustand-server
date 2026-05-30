import {getLinkTagAttrs, getMetaTagAttrs, getStyleAttrs} from "../common/handler/Page";
import type {StandardizedPage, Stylesheet, LinkTag, MetaTag, Attrs} from "../common/handler/Page";

export async function writeHeader(page: StandardizedPage, write: (html: string) => void) {
  write('<meta charset="utf-8">'); // doesn't affect the browser but nice to have
  write(renderMetaTags(await page.getMetaTags()));
  write(renderTitle(await page.getTitle()));
  write(renderLinkTags(await page.getLinkTags()));
  write(renderStylesheets(await page.getStylesheets()));
}

function renderMetaTags(tags: MetaTag[]): string {
  return tags.map(t => {
    const tag = renderOpenTag('meta', getMetaTagAttrs(t));
    return t.noscript ? `<noscript>${tag}</noscript>` : tag;
  }).join('\n');
}

function renderTitle(title: string | null): string {
  if (typeof title === 'string') {
    return `<title>${escapeHtml(title)}</title>`;
  }
  return '';
}

function renderLinkTags(tags: LinkTag[]): string {
  return tags.map(t => {
    return renderOpenTag('link', getLinkTagAttrs(t));
  }).join('\n');
}

function renderStylesheets(stylesheets: Stylesheet[]): string {
  return stylesheets.map(s => {
    const attrs = getStyleAttrs(s);
    if ('href' in s) {
      return renderOpenTag('link', attrs);
    }
    return `${renderOpenTag('style', attrs)}${escapeStyleText(s.text)}</style>`;
  }).join('\n');
}

export function renderOpenTag(name: string, attrs: Attrs): string {
  const a = renderAttrs(attrs);
  return `<${name}${a ? ` ${a}` : ''}>`;
}

function renderAttrs(attrs: Attrs): string {
  return Object.entries(attrs).map(([name, value]) => {
    if (!value) return name;
    return `${name}="${escapeHtml(value)}"`;
  }).join(' ');
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeStyleText(s: string): string {
  return s.replace(/<\/style/gi, '<\\/style');
}
