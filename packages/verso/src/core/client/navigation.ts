import {getAbortPromise} from "../common/abort";
import type {StandardizedPage} from "../common/handler/Page";
import type {Resolver} from "../common/resolver";
import {TaskRunner} from "./task";

export type StartNavigation = () => {
  req: Request;
  interrupt: () => void;
};
export type CommitNavigation = (result: PageResolution) => Promise<void>;
export type PageResolution = {
  page: StandardizedPage;
  routeName: string;
  url: string; // for clientside 3XX redirects
};

export type NavigationState = |
  {
    status: 'pending';
    requestedUrl: string;
    // TODO direction: NavigationDirection;
  } | {
    status: 'idle',
    routeName: string;
    location: string;
  };

const MAX_RESOLUTION_DEPTH = 10;

export class ClientNavigationManager {
  private dfd: PromiseWithResolvers<void> | null;
  private taskRunner: TaskRunner;
  private listeners: Set<() => void>;
  private state: NavigationState;
  private resolutionDepth: number = 0; // doesn't need RLS because only one navigation runs at a time

  constructor(private resolver: Resolver) {
    this.dfd = null;
    this.taskRunner = new TaskRunner({
      onActive: () => {
        this.markNavigationStart();
      },
      onIdle: () => {
        this.markNavigationEnd();
      },
    });
    this.listeners = new Set();
    this.state = {
      status: 'pending',
      requestedUrl: window.location.href,
      // ^this might not be the right url but no one should be reading our state before we start hydration anyway
    };
    window.__waitForVersoNavigation = () => {
      // for playwright tests, etc
      return this.dfd?.promise ?? Promise.resolve();
    };
  }

  async requestNavigation(start: StartNavigation, commit: CommitNavigation) {
    const task = () => {
      const { req, interrupt } = start();
      this.setPending(req.url);
      const promise = Promise.race([
        this.getPageResolution(req),
        getAbortPromise(),
      ])
        .then(async (result) => {
          await commit(result);
          if (!req.signal.aborted) {
            this.setIdle(result);
          }
        });
      return {
        promise,
        interrupt,
      };
    }
    try {
      await this.taskRunner.runTask(task);
    } catch (e) {
      if (this.taskRunner.isInterruption(e)) {
        // swallow
        return;
      }
      throw e;
    }
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): NavigationState {
    return this.state;
  }

  private setPending(requestedUrl: string) {
    this.state = {
      status: 'pending',
      requestedUrl,
    };
    this.emit();
  }

  private setIdle({ routeName, url }: PageResolution) {
    this.state = {
      status: 'idle',
      routeName,
      location: url,
    };
    this.emit();
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
  }

  /**
   * Wrapper around Resolver.resolve() tailored to ClientController
   */
  private async getPageResolution(req: Request): Promise<PageResolution> {
    try {
      if (this.resolutionDepth > MAX_RESOLUTION_DEPTH) {
        throw new Error('max resolution depth exceeded!');
      }
      this.resolutionDepth++;
      const resolution = await this.resolver.resolve(req);
      if (resolution.kind !== 'directive') throw new Error('resolution failed; aborting');
      const { routeName, location, handler } = resolution;
      if (location) {
        const url = new URL(location, window.location.origin);
        if (url.origin === window.location.origin) {
          const newReq = new Request(location, {
            // if we're in hydrate, the controller will bail out
            // as soon as we come back with a different url.
            // so we can assume we're in navigate. in this case,
            // we know the request is a GET and that there's no body.
            signal: req.signal,
          });
          // I'm not sure why a page would attempt to navigate to a url
          // that returns a 3XX redirect server-side, but we might as well
          // do something reasonable here, so we recurse
          return Promise.race([
            this.getPageResolution(newReq),
            getAbortPromise(),
          ]);
        } else {
          window.location.href = location;
          return Promise.reject(new Error('cross-origin redirect'));
        }
      }
      if (!handler) {
        throw new Error('resolver returned success but with no page handler. did you forget to set hasDocument?');
      }
      if (handler.type !== 'page') {
        throw new Error(`client-side navigation only supports page handlers, got ${handler.type}`);
      }
      return {
        page: handler,
        routeName,
        url: new URL(req.url, window.location.origin).href,
      };
    } finally {
      this.resolutionDepth--;
    }
  }

  private markNavigationStart() {
    if (this.dfd) {
      console.warn("[verso] navigation already started");
      return;
    }
    this.dfd = Promise.withResolvers();
  }

  private markNavigationEnd() {
    if (!this.dfd) {
      console.warn("[verso] no navigation in progress");
      return;
    }
    this.dfd.resolve();
    this.dfd = null;
  }

}
