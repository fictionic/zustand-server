export type Task = () => TaskHandle;

export type TaskHandle = {
  promise: Promise<void>;
  interrupt: () => void;
};

export type TaskRunnerOpts = {
  onActive: () => void;
  onIdle: () => void;
};

export class TaskRunner {
  private current: TaskHandle | null;
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

  async runTask(task: Task) {
    if (this.activeCount === 0) this.onActive?.();
    this.activeCount++;
    try {
      if (this.current) {
        const { current } = this;
        current.interrupt();
        this.next = task;
        await silenced(current.promise);
        if (this.next !== task) {
          return Promise.reject(new Error('interrupted'));
        }
        // now it's our turn to run
        this.next = null;
      }
      // start running the task
      const handle = task();
      this.current = handle;
      await handle.promise
        // propagate errors up to the caller
        .finally(() => {
          this.current = null;
        });
    } finally {
      this.activeCount--;
      if (this.activeCount === 0) this.onIdle?.();
    }
  }
}

function silenced(p: Promise<void>): Promise<void> {
  return p.catch(() => {});
}
