import { useEffect, useRef, useState } from "react";

const reduced = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Counts a number up on mount. Eases out, so it settles rather than stops. */
export function useCountUp(target, duration = 900) {
  const [value, setValue] = useState(reduced() ? target : 0);
  const raf = useRef(0);

  useEffect(() => {
    if (reduced()) {
      setValue(target);
      return;
    }
    const start = performance.now();
    const from = 0;
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(from + (target - from) * eased);
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, duration]);

  return value;
}

/* Fires once when an element scrolls into view. */
export function useReveal(threshold = 0.15) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, shown];
}

/* Staggered reveal for a list — returns how many items should be visible. */
export function useStagger(count, step = 90) {
  const [shown, setShown] = useState(reduced() ? count : 0);
  useEffect(() => {
    if (reduced()) {
      setShown(count);
      return;
    }
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= count) clearInterval(id);
    }, step);
    return () => clearInterval(id);
  }, [count, step]);
  return shown;
}

export const prefersReducedMotion = reduced;
