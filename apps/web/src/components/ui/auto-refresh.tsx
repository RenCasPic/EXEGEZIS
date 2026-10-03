"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

/** A refresh that has not come back after this long is given up: the page is loaded again. */
const STUCK_MS = 20_000;

/**
 * Re-renders the server page periodically while something is running.
 * - One refresh at a time: the next one waits until the previous one has
 *   arrived, so they never pile up behind a slow answer.
 * - A refresh that never comes back (a lost request, a server that was busy)
 *   does not freeze the page: after STUCK_MS the page is loaded again.
 * - A hidden tab is not refreshed; it is as soon as it is shown again.
 */
export function AutoRefresh({ everyMs = 2000, active }: { everyMs?: number; active: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const pendingRef = useRef(false);
  const startedAt = useRef(0);

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  useEffect(() => {
    if (!active) return;
    const tick = () => {
      if (document.hidden) return;
      if (pendingRef.current) {
        if (Date.now() - startedAt.current > STUCK_MS) window.location.reload();
        return;
      }
      pendingRef.current = true;
      startedAt.current = Date.now();
      startTransition(() => router.refresh());
    };
    const timer = setInterval(tick, everyMs);
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, everyMs, router]);

  return null;
}
