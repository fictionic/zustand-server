import {getAbortPromise} from "../common/abort";
import type {StandardizedPage} from "../common/handler/Page";
import type {Navigator} from "../common/navigator";
import {TaskRunner} from "./task";

export type StartNavigation = () => {
  req: Request;
  interrupt: () => void;
};
export type CommitNavigation = (result: ClientNavigationResult) => Promise<void>;
export type ClientNavigationResult = { page: StandardizedPage, routeName: string };

export class ClientNavigationManager {
  private dfd: PromiseWithResolvers<void> | null;
  private navigator: Navigator;
  private taskRunner: TaskRunner;

  constructor(navigator: Navigator) {
    this.dfd = null;
    this.navigator = navigator;
    this.taskRunner = new TaskRunner({
      onActive: () => {
        this.markNavigationStart();
      },
      onIdle: () => {
        this.markNavigationEnd();
      },
    });
    window.__waitForVersoNavigation = () => {
      // for playwright tests, etc
      return this.dfd?.promise ?? Promise.resolve();
    };
  }

  async requestNavigation(start: StartNavigation, commit: CommitNavigation) {
    const task = () => {
      const { req, interrupt } = start();
      const promise = Promise.race([
        this.getClientNavigationResult(req),
        getAbortPromise(),
      ])
        .then((result) => commit(result));
      return {
        promise,
        interrupt,
      };
    }
    await this.taskRunner.runTask(task);
  }

  /**
   * Wrapper around Navigator.navigate() tailored to ClientController
   */
  private async getClientNavigationResult(req: Request): Promise<ClientNavigationResult> {
    const navigation = await this.navigator.navigate(req);
    if (navigation.kind !== 'directive') throw new Error('navigation failed; aborting');
    const { routeName, location, handler } = navigation;
    if (location) {
      // not sure why this would happen.
      // react-server does a client transition in this case, but I think it makes more sense
      // to just hand it over to the browser. no guarantee the redirect location is even served
      // by us
      window.location.href = location;
    }
    if (!handler) {
      throw new Error('navigator returned success but with no page handler. did you forget to set hasDocument?');
    }
    if (handler.type !== 'page') {
      throw new Error(`client-side navigation only supports page handlers, got ${handler.type}`);
    }
    return { page: handler, routeName };
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
