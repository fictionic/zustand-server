import {silenced} from "../../util/promise";

export type Task = () => TaskHandle;

export type TaskHandle = {
  promise: Promise<void>;
  interrupt: () => void;
};

export type TaskRunnerOpts = {
  onActive: () => void;
  onIdle: () => void;
};

const INTERRUPTED: unique symbol = Symbol();

type HandleRef = {
  handle: TaskHandle;
  interrupted: boolean;
};

/**
 * Runs interruptible tasks. If a new task needs to run while
 * an existing task is running, the existing task will be interrupted,
 * and when it finishes, the new task will start.
 */
export class TaskRunner {
  private current: HandleRef | null;
  private next: Task | null;
  private activeCount: number;
  private onActive?: () => void;
  private onIdle?: () => void;

  constructor(opts?: TaskRunnerOpts) {
    this.current = null;
    this.next = null;
    this.activeCount = 0;
    const { onActive, onIdle } = opts ?? {};
    this.onActive = onActive;
    this.onIdle = onIdle;
  }

  /**
   * Runs a task.
   * Resolves with void when the task has completed, or throws the error thrown
   * by the task. If the task is interrupted, rejects with a sentinel that can
   * be detected with isInterruption().
   */
  async runTask(task: Task): Promise<void> {
    if (this.activeCount === 0) this.onActive?.();
    this.activeCount++;
    try {
      if (this.current) {
        const { current } = this;
        current.handle.interrupt();
        current.interrupted = true;
        this.next = task;
        await silenced(current.handle.promise);
        if (this.next !== task) {
          // NOTE: this assumes that runTask will only ever be called once on
          // each Task. don't think it's worth handling that case, but just
          // pointing it out here...
          throw INTERRUPTED;
        }
        // now it's our turn to run
        this.next = null;
      }
      // start running the task
      const handle = task();
      const ref: HandleRef = { handle, interrupted: false };
      this.current = ref;
      try {
        await handle.promise
          .catch((err) => {
            if (!ref.interrupted) {
              // propagate external errors up to the caller...
              throw err;
            }
            // ...unless the task was interrupted. we'll swallow and throw our
            // own sentinel, since the consumer only cares that it was
            // interrupted.
          });
        if (ref.interrupted) {
          throw INTERRUPTED;
        }
      } finally {
        this.current = null;
      }
    } finally {
      this.activeCount--;
      if (this.activeCount === 0) this.onIdle?.();
    }
  }

}

export function isInterruption(e: any): boolean {
  return e === INTERRUPTED;
}
