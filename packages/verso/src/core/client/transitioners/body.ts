import type {ReactElement} from "react";
import {PageElementProcessor} from "../../common/PageElementProcessor";
import {getAbortSignal} from "../../common/abort";
import {PAGE_ELEMENT_TOKEN_IDX_ATTR, PAGE_ROOT_ELEMENT_ATTR} from "../../common/constants";
import {createRoot} from "react-dom/client";
import {flushSync} from "react-dom";
import type {ReactRootManager} from "../roots";
import type {NavigateOptions} from "../controller";
import {type RenderableHTMLAttributes} from "../../common/components/attrs";
import {setContainerAttrs, setRootAttrs} from "../setAttrs";

type RenderedElement = |
  {
    kind: 'open';
    index: number;
    attrs: RenderableHTMLAttributes;
  } | {
    kind: 'close';
    index: number;
  } | {
    kind: 'root';
    index: number;
    reactElement: ReactElement,
    attrs: RenderableHTMLAttributes,
  };

type TargetElement = {
  domElement: HTMLElement;
  kind: Exclude<RenderedElement['kind'], 'close'>;
};

export class BodyElementTransitioner {
  private currentContainer: HTMLElement;
  private reusingDom: boolean;
  private didTeardownDom: boolean;

  constructor(private reactRootManager: ReactRootManager, options: NavigateOptions) {
    this.currentContainer = document.body;
    this.reusingDom = options.reuseDom;
    this.didTeardownDom = false;
  }

  async transitionElements(newElements: ReactElement[]) {
    // use the same algorithm as the server render, but with dom mutations
    // rather than writing to an http response stream.
    // in theory we could render elements out of order, unlike on the server,
    // but that would complicate the reuseDom algorithm, and, more importantly,
    // it would be a potentially unexpected discrepancy between server and client
    // pageload behavior.
    // there is still no guarantee that roots are actually presented in their DOM
    // order (who knows how they're styled), but since the server has this restriction,
    // we ought to have it too.
    let currentIndex: number = -1;
    const processor = new PageElementProcessor<RenderedElement>({
      renderContainerOpen: (index, attrs) => {
        return { kind: 'open', index, attrs };
      },
      renderContainerClose: (index) => {
        return { kind: 'close', index };
      },
      renderRootElement: (index, reactElement, attrs) => {
        return { kind: 'root', index, reactElement, attrs };
      },
      consumeRenderedElements: (renderedElements) => {
        if (getAbortSignal().aborted) return; // another navigation is about to run
        for (let renderedElement of renderedElements) {
          currentIndex = renderedElement.index;
          if (this.reusingDom) {
            if (this.tryUpdateExistingDomNodeInPlace(renderedElement)) {
              continue;
            }
            console.log("verso tearing down old dom and writing new page fresh from index ", renderedElement.index);
            this.reusingDom = false;
          }
          if (!this.didTeardownDom) {
            this.tearDownBodyElementsFromIndex(renderedElement.index);
            this.didTeardownDom = true;
          }
          this.appendRenderedElementIntoDom(renderedElement);
        };
      },
    });

    await processor.process(newElements);

    if (this.reusingDom) {
      // clear out the rest of the old page if it had more elements than the new one
      this.tearDownBodyElementsFromIndex(currentIndex + 1);
    }
  }

  private tryUpdateExistingDomNodeInPlace(renderedElement: RenderedElement): boolean {
    const targetElement = this.findTargetElement(renderedElement.index);

    if (renderedElement.kind === 'close') {
      if (targetElement) {
        console.log("[verso] expected container close, got another child");
        return false;
      }
      const newContainer = this.currentContainer.parentElement;
      if (!newContainer) {
        console.error("[verso] could not pop currentContainer. wat?");
        return false;
      }
      this.currentContainer = newContainer;
      return true;
    }

    if (!targetElement) {
      console.log(`[verso] expected to find ${renderedElement.kind}, got nothing`);
      // the new page has more elements than the old page
      return false;
    }

    if (targetElement.kind !== renderedElement.kind) {
      console.log("[verso] next target element has mismatched kind. existing:", targetElement.kind, "new:", renderedElement.kind);
      // the new page has a different shape than the old page
      return false;
    }

    const { domElement: targetDomElement } = targetElement;

    switch (renderedElement.kind) {
      case 'open': {
        const { attrs, index } = renderedElement;
        setContainerAttrs(targetDomElement, attrs, index);
        this.currentContainer = targetDomElement;
        break;
      }
      case 'root': {
        const { reactElement, index, attrs } = renderedElement;
        const previousRootIndex = Number(targetDomElement.getAttribute(PAGE_ELEMENT_TOKEN_IDX_ATTR));
        const reactRoot = this.reactRootManager.getReactRootAndUpdateIndex(previousRootIndex, index);
        if (!reactRoot) {
          console.warn(`[verso] could not find existing ReactRoot for element ${previousRootIndex}; bailing out of reuseDom strategy`);
          return false;
        }
        // let react reconcile the new fiber tree against the existing dom
        reactRoot.render(reactElement);
        // update the attrs
        setRootAttrs(targetDomElement, attrs, index);
        break;
      }
      default:
        renderedElement satisfies never;
        break;
    }
    return true;
  }

  private tearDownBodyElementsFromIndex(index: number) {
    this.reactRootManager.unmountRootsFromIndex(index);
    document.body.querySelectorAll(`[${PAGE_ELEMENT_TOKEN_IDX_ATTR}]`).forEach((element) => {
      const i = Number(element.getAttribute(PAGE_ELEMENT_TOKEN_IDX_ATTR));
      if (i >= index) {
        element.remove();
      }
    });
  }

  private appendRenderedElementIntoDom(renderedElement: RenderedElement) {
    switch (renderedElement.kind) {
      case 'open': {
        const { attrs, index } = renderedElement;
        const newDiv = document.createElement('div');
        setContainerAttrs(newDiv, attrs, index);
        this.currentContainer.appendChild(newDiv);
        this.currentContainer = newDiv;
        break;
      }
      case 'close': {
        this.currentContainer = this.currentContainer.parentElement!;
        break;
      }
      case 'root': {
        const { reactElement, index, attrs } = renderedElement;
        const newNode = document.createElement('div');
        setRootAttrs(newNode, attrs, index)
        this.currentContainer.appendChild(newNode);
        const reactRoot = createRoot(newNode);
        this.reactRootManager.registerReactRoot(reactRoot, index);
        try {
          // without flushSync, the concurrent scheduler could mount roots out of order
          flushSync(() => reactRoot.render(reactElement));
        } catch (err) {
          console.error("[verso] error rendering root", err);
        }
        break;
      }
      default:
        renderedElement satisfies never;
    };
  }

  private findTargetElement(index: number): TargetElement | null {
    // TODO: what if user code has inserted non-verso elements into the dom? we should clear those out
    // (or maybe leave them in if reuseDom is true?)
    // though that would make the algorithm a lot weirder. when do we stop doing one-off deletions and just
    // revert to the scorched earth processor?
    const el = this.currentContainer.querySelector(`:scope > [${PAGE_ELEMENT_TOKEN_IDX_ATTR}="${index}"]`);
    if (!el) {
      console.log("[verso] didn't find verso element at index", index);
      return null;
    }
    if (!(el instanceof HTMLElement)) {
      console.warn("[verso] found non-HTMLElement element with a verso data attr. what are you doing?");
      return null;
    }
    const kind = el.hasAttribute(PAGE_ROOT_ELEMENT_ATTR) ? 'root' : 'open';
    console.log("[verso] found target verso element", el);
    return {
      domElement: el,
      kind,
    }
  }
}

