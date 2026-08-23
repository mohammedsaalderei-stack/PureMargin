import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Languages } from "lucide-react";
import { useC } from "./theme.jsx";
import { useLang } from "./i18n.jsx";

/* Four languages is past the point where a toggle works — a toggle would
   make Filipino three taps away. A menu keeps every language one tap out.

   Rendered through a portal so it escapes parent overflow / stacking
   contexts (sidebar bottom, header bar, etc.) and positions itself based
   on the available viewport space. */
export default function LanguagePicker({ light = false, compact = false }) {
  const C = useC();
  const { t, lang, set, langs } = useLang();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const menuRef = useRef(null);

  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const menuW = 168;
    const menuH = menuRef.current?.offsetHeight || (langs.length * 41 + 8);
    const gap = 8;
    const spaceBelow = window.innerHeight - r.bottom;
    const above = spaceBelow < menuH + gap && r.top > menuH + gap;
    const left = Math.min(r.left, window.innerWidth - menuW - 8);
    setPos({
      left: Math.max(8, left),
      top: above ? r.top - menuH - gap : r.bottom + gap,
    });
  }, [open, langs.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && ref.current.contains(e.target)) return;
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-lg font-semibold ${
          compact ? "p-1.5" : "px-3 py-2 text-sm"
        }`}
        style={{
          border: compact ? "none" : `1px solid ${light ? "rgba(255,255,255,.25)" : C.hairline}`,
          color: light ? "#fff" : C.slate,
        }}
        aria-label={t.settings.language}
        aria-expanded={open}
      >
        <Languages size={compact ? 17 : 15} />
        {!compact && t.langLabel}
      </button>

      {open && pos && createPortal(
        <div
          ref={menuRef}
          className="fixed z-50 rounded-xl overflow-hidden palette-in"
          style={{
            background: C.surface,
            border: `1px solid ${C.hairline}`,
            boxShadow: "0 12px 32px -16px rgba(23,18,31,.4)",
            minWidth: 168,
            left: pos.left,
            top: pos.top,
          }}
        >
          {langs.map((l) => {
            const on = l.id === lang;
            return (
              <button
                key={l.id}
                onClick={() => {
                  set(l.id);
                  setOpen(false);
                }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-start"
                style={{ background: on ? C.irisWash : "transparent", color: on ? C.irisDeep : C.ink }}
              >
                <span className="flex-1">{l.name}</span>
                {on && <Check size={15} />}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}
