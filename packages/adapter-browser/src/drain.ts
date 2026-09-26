/**
 * Waits for in-flight evidence captures (listener promises) with a deadline.
 * Some never settle: Playwright's request.allHeaders() does not resolve for
 * certain blob: requests made inside cross-origin frames (seen on a
 * Cloudflare challenge page), and a page can keep issuing requests forever.
 * Waiting without a bound hung a whole inspection; after the deadline the
 * caller records the capture as incomplete instead.
 *
 * Returns how many captures were still pending at the deadline (0 = all done).
 */
export async function drainWithDeadline(pending: ReadonlySet<Promise<void>>, timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (pending.size > 0) {
    const left = deadline - Date.now();
    if (left <= 0) return pending.size;
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.allSettled([...pending]),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, left);
      }),
    ]);
    clearTimeout(timer);
  }
  return 0;
}
