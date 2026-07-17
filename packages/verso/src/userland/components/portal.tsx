import {useEffect, useMemo, useState, type Key, type ReactNode} from "react";
import {createPortal} from "react-dom";
import {useId} from "../hooks";

const CONTAINER_ATTR_NAME = 'data-verso-portal-container';
const SOURCE_ATTR_NAME = 'data-verso-portal-source';

type Props = {
  children: ReactNode;
  selector: string;
  portalKey?: Key;
};
export function IsomorphicPortal({ children, selector, portalKey }: Props) {
  const id = useId();
  if (globalThis.IS_SERVER) {
    const script = `
const container = document.querySelector('[${CONTAINER_ATTR_NAME}="${id}"]');
const sourceNode = container.firstChild;
const targetNode = document.querySelector("${selector}");
if (!targetNode) throw new Error('[verso-portal:server] no target for portal');
targetNode.appendChild(sourceNode);
container.parentNode.removeChild(container);
`.trim();
    return (
      <div key={portalKey} {...{[CONTAINER_ATTR_NAME]: id}}>
        <div {...{[SOURCE_ATTR_NAME]: id}} style={{ display: 'contents' }}> { children } </div>
        <script dangerouslySetInnerHTML={{ __html: script }} />
      </div>
    );
  }
  const targetNode = useMemo(() => {
    const node = document.querySelector(selector);
    if (!node) throw new Error('[verso-portal:client] no target for portal');
    return node;
  }, []);
  // have to wait until after hydration to switch to createPortal.
  // see here: https://github.com/facebook/react/issues/13097
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const sourceNode = document.querySelector(`[${SOURCE_ATTR_NAME}="${id}"]`);
    if (sourceNode) {
      // don't double-render
      targetNode.removeChild(sourceNode);
    } else {
      // TODO: suppress this warning during client transitions
      console.warn("[verso-portal:client] cannot find server-rendered source node");
    }
    setMounted(true);
  }, []);
  if (!mounted) return null;
  return createPortal(children, targetNode, portalKey);
}
