// A small worker pool for the chunked path: a fixed number of lanes, and the
// first failure stops the rest.
/**
 * Runs work over items, at most `limit` at a time, in order of start. The
 * first failure aborts the rest and is the one rethrown.
 */
export async function runPool<T, R>(
  items: T[],
  limit: number,
  signal: AbortSignal | undefined,
  work: (item: T, signal: AbortSignal) => Promise<R>,
): Promise<R[]> {
  const controller = new AbortController();
  const onAbort = () => {
    controller.abort(signal?.reason);
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  /** Every lane failure, in order; the first is the one rethrown. */
  const failures: unknown[] = [];
  const lane = async () => {
    while (next < items.length && failures.length === 0) {
      const index = next;
      next += 1;
      try {
        results[index] = await work(items[index] as T, controller.signal);
      } catch (error) {
        // Only the first abort takes effect; later ones are no-ops.
        controller.abort(error);
        failures.push(error);
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  if (failures.length > 0) throw signal?.aborted === true ? signal.reason : failures[0];
  return results;
}
