import { useEffect, useRef, useState } from "react";
import { useC } from "./theme.jsx";
import { useLang } from "./i18n.jsx";
import { prefersReducedMotion } from "./hooks.js";
import NeonMark from "./NeonMark.jsx";

/* Startup, following the supplied animation.

   Its beats, kept as authored: a neon tube striking — the flicker table is
   lifted verbatim — a light sweep across the frame at ignition, a slow
   breathing hum, then rest and fade. Timing is driven by one clock rather
   than a chain of setTimeouts, so the phases can overlap the way they do
   in the original instead of stepping one after another. */

/* Verbatim from the source: time offset, brightness. A real tube doesn't
   ramp up, it stutters to life. */
const FLICKER = [
  [0.0, 0.0], [0.05, 1.0], [0.11, 0.1], [0.18, 0.85], [0.24, 0.06],
  [0.33, 1.0], [0.42, 0.22], [0.52, 0.95], [0.63, 0.45], [0.76, 1.0],
];

function flickerLevel(t) {
  if (t <= 0) return 0;
  if (t >= 0.76) return 1;
  let v = 0;
  for (const [at, level] of FLICKER) if (t >= at) v = level;
  return v;
}

const easeOutBack = (x) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
const easeInQuad = (x) => x * x;
const clamp01 = (x) => Math.max(0, Math.min(1, x));

const track = (t, start, end, ease = (x) => x) =>
  ease(clamp01((t - start) / Math.max(end - start, 0.0001)));

const IGNITE = 0.15;
const HUM = 1.2;
const REST = 2.5;
const END = 4.0;

export default function Splash({ onDone }) {
  const C = useC();
  const { t, rtl } = useLang();
  const instant = prefersReducedMotion();
  const [T, setT] = useState(0);
  const raf = useRef(0);

  useEffect(() => {
    if (instant) {
      const id = setTimeout(onDone, 700);
      return () => clearTimeout(id);
    }
    const started = performance.now();
    const tick = (now) => {
      const elapsed = (now - started) / 1000;
      setT(elapsed);
      if (elapsed >= END) {
        onDone();
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [instant, onDone]);

  const ignite = instant ? 1 : flickerLevel(T - IGNITE);
  const fade = instant ? 1 : 1 - track(T, REST + 0.35, END, easeInQuad);
  const on = Math.min(ignite, fade);

  // Breathing, once lit.
  const breathe = 0.5 + 0.5 * Math.sin((T - HUM) * 1.5);
  const glow = on * (0.72 + 0.28 * breathe);

  // Pop in, then drift very slightly larger as it settles.
  const scale =
    (1.1 - 0.1 * track(T, IGNITE, IGNITE + 0.9, easeOutBack)) *
    (1 + 0.05 * track(T, HUM, REST + 1.4));
  const lift = 26 * (1 - track(T, IGNITE, IGNITE + 1.0, easeOutCubic));

  // The bloom just after the tube catches.
  const flash = 1 - track(T, IGNITE + 0.72, IGNITE + 1.5, easeOutCubic);

  // Sweep travels once, at ignition.
  const sweepAt = -0.35 + 1.7 * track(T, IGNITE, IGNITE + 0.7, easeInQuad);
  const sweepOpacity = 0.9 * (1 - track(T, IGNITE + 0.35, IGNITE + 0.85));

  const wordmarkIn = instant ? 1 : track(T, HUM + 0.1, HUM + 0.9, easeOutCubic);

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden"
      style={{
        background: "radial-gradient(circle at 50% 46%, #14061f 0%, #08040e 55%, #050308 100%)",
        opacity: T >= END - 0.35 ? 0 : 1,
        transition: "opacity .35s ease",
      }}
    >
      {/* Drifting circuit grid, brightening with the tube. */}
      <div className="absolute inset-0" style={{ overflow: "hidden" }}>
        {[
          [0, 96, 0.16, (T * 14) % 96],
          [90, 96, 0.16, -((T * 14) % 96)],
          [0, 32, 0.07, -((T * 7) % 32)],
        ].map(([angle, gap, op, off], i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              inset: "-20%",
              backgroundImage: `repeating-linear-gradient(${angle}deg, rgba(168,85,247,.5) 0 1px, transparent 1px ${gap}px)`,
              opacity: op * (0.55 + glow * 0.9),
              transform: `translate(${off}px, ${off * 0.6}px)`,
              maskImage: "radial-gradient(closest-side at 50% 50%, #000 20%, transparent 82%)",
              WebkitMaskImage: "radial-gradient(closest-side at 50% 50%, #000 20%, transparent 82%)",
            }}
          />
        ))}
      </div>

      {/* The sweep. */}
      {sweepOpacity > 0.01 && (
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${sweepAt * 100}%`,
            width: "38%",
            transform: "translateX(-50%) skewX(-14deg)",
            background:
              "linear-gradient(90deg, transparent, rgba(192,132,252,.20), rgba(232,196,255,.34), rgba(192,132,252,.20), transparent)",
            opacity: sweepOpacity,
            filter: "blur(14px)",
            pointerEvents: "none",
          }}
        />
      )}

      {/* Halo behind the mark. */}
      <div
        style={{
          position: "absolute",
          width: 900,
          height: 900,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(168,85,247,.55) 0%, rgba(139,63,235,.22) 34%, transparent 68%)",
          opacity: 0.18 + glow * 0.55 + flash * 0.35,
          filter: "blur(24px)",
          pointerEvents: "none",
        }}
      />

      <div
        className="relative flex flex-col items-center"
        style={{ transform: `scale(${scale}) translateY(${lift}px)` }}
      >
        <NeonMark size={280} glow={0.5 + glow} intensity={0.15 + on * 0.85} />

        <div
          className="display font-bold mt-8"
          style={{
            fontSize: 20,
            letterSpacing: rtl ? 0 : "0.34em",
            color: "#E9D5FF",
            opacity: wordmarkIn * fade,
            transform: `translateY(${(1 - wordmarkIn) * 10}px)`,
            textShadow: `0 0 24px rgba(168,85,247,${0.5 * glow})`,
          }}
        >
          {t.wordmark}
        </div>

        <div
          className="micro mt-3"
          style={{
            color: "rgba(233,213,255,.55)",
            opacity: track(T, HUM + 0.5, HUM + 1.3) * fade,
          }}
        >
          {t.tagline}
        </div>
      </div>

      {/* Bloom over everything, right after ignition. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(circle at 50% 46%, rgba(216,180,254,.35), transparent 55%)",
          opacity: flash * 0.55,
          mixBlendMode: "screen",
        }}
      />
      {/* Vignette. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          opacity: 0.35,
          background: "radial-gradient(circle at 50% 50%, transparent 45%, rgba(0,0,0,.85) 100%)",
        }}
      />
    </div>
  );
}
