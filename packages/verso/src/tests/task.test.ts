import {describe, test, expect} from "vitest";
import {TaskRunner, type Task} from "../core/client/task";

type Fake = {
  task: Task;
  started: () => boolean;
  interrupted: () => boolean;
  settled: () => boolean;
  finish: () => void;
  fail: (err?: unknown) => void;
};

// Mock Task with externally controlled lifecycle.
// By default, interrupt() rejects the task's promise — matching the real-world
// shape where the in-flight async work surfaces an AbortError. Pass
// `resolveOnInterrupt: true` to simulate a Task that ignores interrupt and
// resolves normally.
function makeFakeTask(opts: { resolveOnInterrupt?: boolean } = {}): Fake {
  const dfd = Promise.withResolvers<void>();
  let started = false;
  let interrupted = false;
  let settled = false;

  dfd.promise.then(
    () => { settled = true; },
    () => { settled = true; },
  );
  // Suppress unhandled-rejection noise if the test never observes this.
  dfd.promise.catch(() => {});

  const task: Task = () => {
    started = true;
    return {
      promise: dfd.promise,
      interrupt: () => {
        interrupted = true;
        if (!opts.resolveOnInterrupt) {
          dfd.reject(new Error('interrupted'));
        }
      },
    };
  };

  return {
    task,
    started: () => started,
    interrupted: () => interrupted,
    settled: () => settled,
    finish: () => dfd.resolve(),
    fail: (err = new Error('failed')) => dfd.reject(err),
  };
}

// Drain the microtask queue. Several rounds because chained awaits need a few
// ticks to settle.
async function tick() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

// Swallow rejections from runTask promises that the test doesn't otherwise
// observe (e.g. interrupted tasks).
function silence<T>(p: Promise<T>): Promise<T> {
  p.catch(() => {});
  return p;
}

describe('TaskRunner', () => {

  test('runs a single task to completion', async () => {
    const runner = new TaskRunner();
    const fake = makeFakeTask();

    const done = runner.runTask(fake.task);
    await tick();
    expect(fake.started()).toBe(true);
    expect(fake.settled()).toBe(false);

    fake.finish();
    await done;
    expect(fake.settled()).toBe(true);
  });

  test('runs sequential tasks', async () => {
    const runner = new TaskRunner();
    const a = makeFakeTask();
    const b = makeFakeTask();

    const aDone = runner.runTask(a.task);
    a.finish();
    await aDone;

    // Runner should be ready for B with no leftover state.
    const bDone = runner.runTask(b.task);
    await tick();
    expect(b.started()).toBe(true);
    expect(a.interrupted()).toBe(false);

    b.finish();
    await bDone;
    expect(b.settled()).toBe(true);
  });

  test('interrupts the current task when a new task arrives', async () => {
    const runner = new TaskRunner();
    const a = makeFakeTask();
    const b = makeFakeTask();

    const aDone = silence(runner.runTask(a.task));
    await tick();
    expect(a.started()).toBe(true);

    const bDone = runner.runTask(b.task);
    await tick();
    expect(a.interrupted()).toBe(true);

    await aDone.catch(() => {});

    expect(b.started()).toBe(true);
    b.finish();
    await bDone;
    expect(b.settled()).toBe(true);
  });

  test('waits for interrupted task to fully settle before starting next', async () => {
    // RLS-safety: the next task installs a new RLS scope. If we install it
    // before the interrupted task's promise settles, the interrupted task's
    // continuation will write into the wrong scope.
    const runner = new TaskRunner();
    const a = makeFakeTask({ resolveOnInterrupt: true });
    const b = makeFakeTask();

    const aDone = silence(runner.runTask(a.task));
    await tick();

    const bDone = runner.runTask(b.task);
    await tick();
    expect(a.interrupted()).toBe(true);

    // A's promise has not settled yet. B must not have started.
    expect(b.started()).toBe(false);

    a.finish();
    await tick();

    // Now A is settled; B can proceed.
    expect(b.started()).toBe(true);

    b.finish();
    await bDone;
    await aDone.catch(() => {});
  });

  test('multi-arrival: only the latest task runs', async () => {
    const runner = new TaskRunner();
    const a = makeFakeTask();
    const b = makeFakeTask();
    const c = makeFakeTask();

    const aDone = silence(runner.runTask(a.task));
    await tick();

    // B and C both arrive while A is in-flight.
    const bDone = silence(runner.runTask(b.task));
    const cDone = runner.runTask(c.task);
    await tick();

    expect(a.interrupted()).toBe(true);

    await aDone.catch(() => {});
    await bDone.catch(() => {});

    // B was displaced before it could start.
    expect(b.started()).toBe(false);

    // C is the one that actually runs.
    expect(c.started()).toBe(true);
    c.finish();
    await cDone;
    expect(c.settled()).toBe(true);
  });

  test('displaced queued task rejects with interruption without running', async () => {
    const runner = new TaskRunner();
    const a = makeFakeTask();
    const b = makeFakeTask();
    const c = makeFakeTask();

    const aDone = silence(runner.runTask(a.task));
    await tick();

    // B is queued, then displaced by C before either runs.
    const bDone = runner.runTask(b.task);
    const cDone = runner.runTask(c.task);

    await aDone.catch(() => {});

    // B's runTask rejects with an interruption — it never ran.
    const bError = await bDone.then(() => null).catch((e) => e);
    expect(runner.isInterruption(bError)).toBe(true);
    expect(b.started()).toBe(false);

    expect(c.started()).toBe(true);
    c.finish();
    await cDone;
  });

  test('three-arrival: middle ones never start', async () => {
    const runner = new TaskRunner();
    const a = makeFakeTask();
    const b = makeFakeTask();
    const c = makeFakeTask();
    const d = makeFakeTask();

    const aDone = silence(runner.runTask(a.task));
    await tick();

    const bDone = silence(runner.runTask(b.task));
    const cDone = silence(runner.runTask(c.task));
    const dDone = runner.runTask(d.task);
    await tick();

    await aDone.catch(() => {});
    await bDone.catch(() => {});
    await cDone.catch(() => {});

    expect(b.started()).toBe(false);
    expect(c.started()).toBe(false);

    expect(d.started()).toBe(true);
    d.finish();
    await dDone;
    expect(d.settled()).toBe(true);
  });

  test('task failure propagates to caller', async () => {
    const runner = new TaskRunner();
    const a = makeFakeTask();

    const aDone = runner.runTask(a.task);
    await tick();
    a.fail(new Error('boom'));

    await expect(aDone).rejects.toThrow('boom');
  });

  test('runner state is clean after task failure', async () => {
    // If a task throws, the runner must still be usable for subsequent tasks.
    const runner = new TaskRunner();
    const a = makeFakeTask();
    const b = makeFakeTask();

    const aDone = runner.runTask(a.task);
    await tick();
    a.fail(new Error('boom'));
    await aDone.catch(() => {});

    const bDone = runner.runTask(b.task);
    await tick();
    expect(b.started()).toBe(true);
    // A is already done (failed), so B should not have called interrupt on it.
    expect(a.interrupted()).toBe(false);

    b.finish();
    await bDone;
    expect(b.settled()).toBe(true);
  });

  test('runTask rejects with interruption even when task resolves instead of rejecting', async () => {
    // Guards the `if (ref.interrupted) throw INTERRUPTED` branch: a task that
    // ignores interrupt() and resolves normally should still cause runTask to
    // reject with an interruption, not resolve successfully.
    const runner = new TaskRunner();
    const a = makeFakeTask({ resolveOnInterrupt: true });
    const b = makeFakeTask();

    const aDone = runner.runTask(a.task);
    await tick();

    silence(runner.runTask(b.task));
    await tick();
    expect(a.interrupted()).toBe(true);

    a.finish();
    await tick();

    const aError = await aDone.then(() => null).catch((e) => e);
    expect(runner.isInterruption(aError)).toBe(true);
  });

  test('interrupted task failure does not surface to queued task caller', async () => {
    // When A is interrupted, its promise rejects. B is in drain wait.
    // B's runTask should not reject because of A's failure — that's A's caller's
    // concern, not B's.
    const runner = new TaskRunner();
    const a = makeFakeTask();
    const b = makeFakeTask();

    const aDone = silence(runner.runTask(a.task));
    await tick();

    const bDone = runner.runTask(b.task);
    await tick();
    expect(a.interrupted()).toBe(true);

    await aDone.catch(() => {});

    // B proceeds normally; bDone resolves on B's success.
    expect(b.started()).toBe(true);
    b.finish();
    await expect(bDone).resolves.toBeUndefined();
  });

});
