import type {NavigateOptions} from "./controller"

export type OnPopState = (url: string, options: NavigateOptions) => void;

export type NavigationDirection = 'PUSH' | 'POP';

interface VersoHistoryFrame {
  isVerso: true;
  options: NavigateOptions;
}

export class HistoryManager {
  private onPopState: OnPopState;

  constructor(onPopState: OnPopState) {
    this.onPopState = onPopState;
  }

  stampHistoryFrame() {
    const frame = this.createVersoFrame({});
    window.history.replaceState(frame, '');
  }

  installListener() {
    window.addEventListener('popstate', (event) => {
      const frame = event.state;
      if (!this.isVersoFrame(frame)) {
        return;
      }
      const options = frame.options;
      this.onPopState(location.pathname + location.search, options);
    });
  }

  pushFrame(url: string, options: NavigateOptions) {
    const frame = this.createVersoFrame(options);
    history.pushState(frame, '', url);
  }

  // helpers

  private isVersoFrame(frame: any): frame is VersoHistoryFrame {
    return frame.isVerso;
  }

  private createVersoFrame(options: NavigateOptions): VersoHistoryFrame {
    return {
      isVerso: true,
      options,
    };
  }

}
