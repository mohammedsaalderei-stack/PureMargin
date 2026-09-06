import { useEffect, useRef } from "react";

/* Reload when somebody comes back to the screen.

   ── Why this exists ──────────────────────────────────────────────────────

   The data all lives on the server, so a phone and a desktop are already
   looking at the same records. What they were not doing is looking at them
   *now*: every screen fetched once when it mounted and then never again. Open
   the stock list on a laptop, receive a delivery on a phone, and the laptop
   goes on showing the balances it happened to fetch when the tab was opened —
   for as long as the tab stays open, which for a screen somebody keeps up all
   day is the whole day.

   Nothing was out of sync in the store. The screen was just old, and there was
   no way to tell by looking at it, which is worse than being obviously stale:
   a balance that is thirty minutes behind looks exactly like a balance that is
   correct.

   ── Why on return, and not on a timer ────────────────────────────────────

   A timer refetches hardest when nobody is looking. The moment a figure
   actually has to be right is the moment somebody turns back to it — unlocking
   the phone, switching back to the tab — and that is a signal the browser
   already gives us. It costs one request per return instead of one every
   thirty seconds per open tab, and it is the only moment at which a stale
   number can mislead anybody.

   The dashboard and the deliveries feed keep their own timers; those show
   things that arrive on their own while being watched, which is the case a
   timer is genuinely for.

   ── Why the callback is held in a ref ────────────────────────────────────

   Some screens declare `load` with useCallback and some as a plain function
   rebuilt on every render, and several take arguments with defaults bound to
   current state. Depending on its identity would resubscribe on every render
   for half of them. Holding the latest in a ref subscribes once and still
   calls the current closure, so a screen's own defaults — the selected period,
   the chosen costing method — are the ones that get used. */

const MIN_GAP_MS = 4000;

export function useFresh(load, { enabled = true } = {}) {
  const latest = useRef(load);
  latest.current = load;
  const lastRun = useRef(Date.now());

  useEffect(() => {
    if (!enabled) return undefined;

    const refresh = () => {
      /* `focus` and `visibilitychange` both fire when a tab is switched back
         to, and a blurred window can fire `focus` without becoming visible.
         One reload per return, and only when there is something to look at. */
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRun.current < MIN_GAP_MS) return;
      lastRun.current = now;
      try {
        latest.current?.();
      } catch { /* a screen's own loader owns its errors */ }
    };

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    /* Coming back online after a tunnel or a lift is the same situation: what
       is on screen was fetched before the gap. */
    window.addEventListener("online", refresh);

    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [enabled]);
}
