/** Runs deterministic menu work in small browser tasks so pending UI can paint. */
export function startMenuAssemblyTask<Result>(
  steps: Iterator<unknown, Result>,
  callbacks: {
    onSlow: () => void;
    onComplete: (result: Result) => void;
    onError: (error: unknown) => void;
  },
  timing: {
    setTimeout: (callback: () => void, delay: number) => number;
    clearTimeout: (id: number) => void;
  } = {
    setTimeout: (callback, delay) => window.setTimeout(callback, delay),
    clearTimeout: (id) => window.clearTimeout(id),
  },
) {
  let active = true;
  let workTimer: number | undefined;
  const slowTimer = timing.setTimeout(() => {
    if (active) callbacks.onSlow();
  }, 2_000);

  function finish() {
    active = false;
    timing.clearTimeout(slowTimer);
    if (workTimer !== undefined) timing.clearTimeout(workTimer);
  }

  function runNext() {
    if (!active) return;
    try {
      const next = steps.next();
      if (next.done) {
        finish();
        callbacks.onComplete(next.value);
      } else {
        workTimer = timing.setTimeout(runNext, 0);
      }
    } catch (error) {
      finish();
      callbacks.onError(error);
    }
  }

  workTimer = timing.setTimeout(runNext, 0);
  return {
    cancel() {
      if (active) finish();
    },
  };
}
