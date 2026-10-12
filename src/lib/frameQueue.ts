/**
 * Runs queued tasks after the next paint, in slices of at most `budgetMs`, so a burst of work
 * (like drawing a chart in every grid cell) never holds up a frame for long.
 */
export function createFrameQueue(budgetMs = 8) {
  const tasks = new Set<() => void>();
  let scheduled = false;

  const drain = () => {
    scheduled = false;
    const start = performance.now();
    for (const task of tasks) {
      tasks.delete(task);
      try {
        task();
      } catch (error) {
        console.error('Queued task failed:', error);
      }
      if (performance.now() - start >= budgetMs) break;
    }
    if (tasks.size > 0) schedule();
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    // requestAnimationFrame runs just before a paint; the timeout lands just after it.
    requestAnimationFrame(() => setTimeout(drain, 0));
  };

  return {
    /** Queues `task` and returns a function that cancels it if it has not run yet. */
    add(task: () => void): () => void {
      tasks.add(task);
      schedule();
      return () => { tasks.delete(task); };
    },
  };
}
