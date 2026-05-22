import type {NavigateOptions} from "./controller";

export type OnPopState = (url: string, options: NavigateOptions) => Promise<void>;

export type NavigationDirection = 'PUSH' | 'POP';

export const VERSO_HISTORY_FRAME_KEY = '__verso_v1__';

type VersoHistoryFrame = {
  [VERSO_HISTORY_FRAME_KEY]: {
    options: NavigateOptions;
  };
}

export class HistoryManager {
  constructor(private onPopToVersoState: OnPopState) {}

  installListener() {
    window.addEventListener('popstate', this.onPopState.bind(this));
  }

  stampHistoryFrame(options: NavigateOptions) {
    // we'll merge into the existing frame if we can.
    // otherwise we'll have to clobber it. "sorry folks" -gigabo
    const old = history.state;
    const base: object = (!old || typeof old !== 'object') ? {} : old;
    const frame = this.createVersoFrame(options);
    const merged = {
      ...base,
      ...frame,
    };
    window.history.replaceState(merged, '');
  }

  pushFrame(url: string) {
    // just as with hydrate, we can safely put reuseDom in the initial frame
    const frame = this.createVersoFrame({ reuseDom: true });
    history.pushState(frame, '', url);
  }

  getNavigateOptions(): NavigateOptions | null {
    const frame = window.history.state;
    if (!this.isVersoFrame(frame)) {
      return null;
    }
    return frame[VERSO_HISTORY_FRAME_KEY].options;
  }

  private async onPopState(event: PopStateEvent) {
    const { state } = event;
    if (!this.isVersoFrame(state)) {
      return;
    }
    const { options } = state[VERSO_HISTORY_FRAME_KEY];
    await this.onPopToVersoState(location.pathname + location.search, options);
  }

  private isVersoFrame(frame: any): frame is VersoHistoryFrame {
    return frame && typeof frame === 'object' && VERSO_HISTORY_FRAME_KEY in frame;
  }

  private createVersoFrame(options: NavigateOptions): VersoHistoryFrame {
    return {
      [VERSO_HISTORY_FRAME_KEY]: {
        options,
      },
    };
  }

}
