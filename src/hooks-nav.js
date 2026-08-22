import { useEffect, useRef } from "react";

/* Horizontal swipe between screens.
   Ignores vertical drags so scrolling never triggers navigation, and ignores
   gestures that start on a chart or a scrollable pane. */
export function useSwipe(ref, { onNext, onPrev, enabled = true }) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    let startX = 0, startY = 0, tracking = false;

    const start = (e) => {
      if (e.touches.length !== 1) return;
      const target = e.target;
      if (target.closest?.(".chart, textarea, input, [data-no-swipe]")) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true;
    };

    const end = (e) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.abs(dx) < 65) return;          // too small to be deliberate
      if (Math.abs(dy) > Math.abs(dx) * 0.7) return; // mostly vertical
      if (dx < 0) onNext?.();
      else onPrev?.();
    };

    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchend", end, { passive: true });
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchend", end);
    };
  }, [ref, onNext, onPrev, enabled]);
}

/* Remembers how far each screen was scrolled, so switching tabs and coming
   back doesn't dump you at the top of a long dashboard. */
export function useScrollMemory(key) {
  const store = useRef(new Map());
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current?.querySelector("[data-scroll]") || ref.current;
    if (!el) return;
    const saved = store.current.get(key);
    if (saved) el.scrollTop = saved;
    const onScroll = () => store.current.set(key, el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [key]);

  return ref;
}
