import {renderToString} from "react-dom/server";
import type {RenderableHTMLAttributes} from "../common/components/attrs"
import {PAGE_ELEMENT_TOKEN_IDX_ATTR, PAGE_ROOT_ELEMENT_ATTR} from "../common/constants";

export function renderRootToString(index: number, innerHtml: string, attrs: RenderableHTMLAttributes) {
  const renderable = (
    <div
      {...attrs}
      {...{[PAGE_ELEMENT_TOKEN_IDX_ATTR]: String(index)}}
      {...{[PAGE_ROOT_ELEMENT_ATTR]: ''}}
      dangerouslySetInnerHTML={{
        __html: innerHtml,
      }}
    />
  );
  return renderToString(renderable);
}

const DIV_CLOSE = '</div>';

export function renderContainerOpenToString(index: number, attrs: RenderableHTMLAttributes): string {
  const renderable = (
    <div
      {...attrs}
      {...{[PAGE_ELEMENT_TOKEN_IDX_ATTR]: String(index)}}
    />
  );
  const html = renderToString(renderable);
  return html.slice(0, -(DIV_CLOSE.length)) + '\n';
}

export function renderContainerCloseToString(): string {
  return `${DIV_CLOSE}\n`;
}

