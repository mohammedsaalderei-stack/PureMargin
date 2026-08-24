import { useEffect, useState } from "react";
import { useC } from "../theme.jsx";
import { useLang } from "../i18n.jsx";

/* A fixed progress rail down the side of the landing page.

   It stays pinned to the middle of the viewport on purpose — it's a progress
   indicator, not page content. What moves is the fill and the travelling
   marker, and both track scroll continuously rather than snapping between
   four states. An indicator that only changes at four thresholds reads as
   broken, because most of the time you scroll and nothing happens.

   Position is measured with getBoundingClientRect(), which is relative to the
   viewport and therefore correct no matter which element is doing the
   scrolling — window, #root, or an inner container. Earlier versions tried to
   listen for scroll on a specific target and failed, because `scroll` doesn't
   bubble and the scrolling element here isn't reliably the window. */

const STEP = 34; // vertical distance between entries, in px

export default function SectionRail({ ids }) {
  const C = useC();
  const { t } = useLang();
  const [active, setActive] = useState(0);
  const [progress, setProgress] = useState(0);
  const key = ids.join(",");

  useEffect(() => {
    const list = key.split(",");
    let raf = 0;
    let lastTop = null;

    /* If a tracked id isn't in the document the rail can never advance past
       the last one that is — which looks exactly like being stuck. Say so
       once, rather than failing silently. */
    let checked = false;

    const measure = () => {
      const els = list.map((id) => document.getElementById(id));

      if (!checked) {
        checked = true;
        const missing = list.filter((id, i) => !els[i]);
        if (missing.length) {
          console.warn(
            `[sufra] SectionRail: no element found for ${missing.join(", ")}. ` +
              "The rail cannot advance past the last section that exists."
          );
        }
      }

      const first = els[0];
      if (!first) return;

      const top = Math.round(first.getBoundingClientRect().top);
      if (top === lastTop) return;
      lastTop = top;

      const line = window.innerHeight * 0.35;

      /* Which entry is current, and how far between it and the next. */
      let index = 0;
      for (let i = 0; i < els.length; i++) {
        if (els[i] && els[i].getBoundingClientRect().top <= line) index = i;
      }


      const current = els[index];
      const next = els[index + 1];
      let within = 0;
      if (current) {
        const start = current.getBoundingClientRect().top - line;
        const span = next
          ? next.getBoundingClientRect().top - current.getBoundingClientRect().top
          : current.offsetHeight || 1;
        within = Math.min(1, Math.max(0, -start / Math.max(span, 1)));
      }

      const doc = document.documentElement;
      const scrolled = window.scrollY || doc.scrollTop || document.body.scrollTop || 0;
      const atEnd = window.innerHeight + scrolled >= doc.scrollHeight - 4;

      const fraction = atEnd
        ? list.length - 1
        : Math.min(list.length - 1, index + within);

      setActive(atEnd ? list.length - 1 : index);
      setProgress(fraction);
    };

    const tick = () => {
      measure();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [key]);

  const trackHeight = (ids.length - 1) * STEP;

  return (
    <nav
      className="hidden xl:flex fixed top-1/2 -translate-y-1/2 z-30"
      style={{ insetInlineStart: 28 }}
      aria-label={t.nav.how}
    >
      {/* Track and fill — the part that moves continuously. */}
      <div className="relative me-3" style={{ width: 2, height: trackHeight, marginTop: 6 }}>
        <div className="absolute inset-0 rounded-full" style={{ background: C.hairline, opacity: 0.6 }} />
        <div
          className="absolute top-0 left-0 right-0 rounded-full"
          style={{ height: `${(progress / Math.max(ids.length - 1, 1)) * 100}%`, background: C.iris }}
        />
        {/* The marker slides between entries rather than jumping. */}
        <div
          className="absolute rounded-full"
          style={{
            width: 8,
            height: 8,
            left: -3,
            top: progress * STEP - 4,
            background: C.iris,
            boxShadow: `0 0 0 4px ${C.bone}`,
          }}
        />
      </div>

      <div className="flex flex-col" style={{ gap: STEP - 14 }}>
        {ids.map((id, i) => {
          const on = active === i;
          return (
            <button
              key={id}
              onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" })}
              className="flex items-center gap-2.5"
              style={{ height: 14 }}
              aria-current={on ? "true" : undefined}
            >
              <span
                className="data text-[11px] tabular-nums transition-all duration-200"
                style={{ color: on ? C.iris : C.slate, opacity: on ? 1 : 0.45, fontWeight: on ? 600 : 400 }}
                dir="ltr"
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span
                className="text-xs font-medium whitespace-nowrap transition-all duration-200"
                style={{
                  color: on ? C.ink : C.slate,
                  opacity: on ? 1 : 0,
                  transform: on ? "none" : "translateX(-4px)",
                }}
              >
                {t.sections[id === "sources" ? "flow" : id === "capabilities" ? "intelligence" : id]}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
