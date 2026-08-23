import { useEffect, useRef, useState } from "react";
import { useC } from "./theme.jsx";
import { useLang } from "./i18n.jsx";
import { prefersReducedMotion } from "./hooks.js";
import BrandMark from "./BrandMark.jsx";

/* Startup animation — clean fade-in with the new geometric mark.
   The mark scales up gently, the wordmark fades in below, then the
   whole thing fades out. Respects prefers-reduced-motion. */

const REST = 1.2;
const END = 2.0;

const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
const easeInQuad = (x) => x * x;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const track = (t, start, end, ease = (x) => x) => ease(clamp01((t - start) / Math.max(end - start, 0.0001)));

export default function Splash({ onDone }) {
  const C = useC();
  const { t, rtl } = useLang();
  const instant = prefersReducedMotion();
  const [T, setT] = useState(0);
  const raf = useRef(0);

  useEffect(() => {
    if (instant) { const id = setTimeout(onDone, 500); return () => clearTimeout(id); }
    const started = performance.now();
    const tick = (now) => {
      const elapsed = (now - started) / 1000;
      setT(elapsed);
      if (elapsed >= END) { onDone(); return; }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [instant, onDone]);

  const markIn = instant ? 1 : track(T, 0.1, 0.6, easeOutCubic);
  const wordmarkIn = instant ? 1 : track(T, 0.5, 1.0, easeOutCubic);
  const fade = instant ? 1 : 1 - track(T, REST, END, easeInQuad);

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden"
      style={{ background: "radial-gradient(circle at 50% 50%, #131028 0%, #0B0815 60%, #050308 100%)",
        opacity: T >= END - 0.3 ? 0 : 1, transition: "opacity .3s ease" }}>
      {/* Ambient glow */}
      <div style={{ position: "absolute", width: 600, height: 600, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(139,92,246,0.25) 0%, transparent 70%)",
        opacity: markIn * fade * 0.6, filter: "blur(40px)", pointerEvents: "none" }} />

      <div className="relative flex flex-col items-center"
        style={{ transform: `scale(${0.92 + 0.08 * markIn})`, opacity: markIn * fade }}>
        <BrandMark size={120} />

        <div className="display font-bold mt-6"
          style={{ fontSize: 20, letterSpacing: rtl ? 0 : "0.2em",
            color: "#E8E6F0", opacity: wordmarkIn * fade,
            transform: `translateY(${(1 - wordmarkIn) * 8}px)` }}>
          {t.wordmark}
        </div>
        <div className="micro mt-2" style={{ color: C.slate, opacity: track(T, 0.8, 1.3) * fade }}>
          {t.tagline}
        </div>
      </div>
    </div>
  );
}
