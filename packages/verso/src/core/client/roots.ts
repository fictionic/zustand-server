import {type Root as ReactRoot} from "react-dom/client";

export class ReactRootManager {
  private reactRootsByIndex: Map<number, ReactRoot>;
  private lastIndex: number;

  constructor() {
    this.reactRootsByIndex = new Map();
    this.lastIndex = -1;
  }

  registerReactRoot(root: ReactRoot, index: number) {
    const existing = this.reactRootsByIndex.get(index);
    if (existing) {
      console.error(`[verso] overwriting react root at index ${index}! how did this happen?`);
      existing.unmount();
    }
    this.reactRootsByIndex.set(index, root);
    if (index > this.lastIndex) {
      this.lastIndex = index;
    }
  }

  getReactRootAndUpdateIndex(oldIndex: number, newIndex: number): ReactRoot | null {
    const reactRoot = this.reactRootsByIndex.get(oldIndex);
    if (!reactRoot) {
      return null;
    }
    this.reactRootsByIndex.delete(oldIndex);
    this.reactRootsByIndex.set(newIndex, reactRoot);
    return reactRoot;
  }

  unmountRootsFromIndex(index: number) {
    for (let i=index; i<=this.lastIndex; i++) {
      this.reactRootsByIndex.get(i)?.unmount();
      this.reactRootsByIndex.delete(i);
    }
    this.lastIndex = Math.max(-1, ...this.reactRootsByIndex.keys());
  }

}
