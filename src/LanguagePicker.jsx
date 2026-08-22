import { useEffect, useRef, useState } from "react";
import { Check, Languages } from "lucide-react";
import { useC } from "./theme.jsx";
import { useLang } from "./i18n.jsx";

/* Four languages is past the point where a toggle works — a toggle would
   make Filipino three taps away. A menu keeps every language one tap out. */
export default function LanguagePicker({ light = false, compact = false }) {
  const C = useC();
  const { t, lang, set, langs } = useLang();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
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

      {open && (
        <div
          className="absolute end-0 mt-2 z-50 rounded-xl overflow-hidden palette-in"
          style={{
            background: C.surface,
            border: `1px solid ${C.hairline}`,
            boxShadow: "0 12px 32px -16px rgba(23,18,31,.4)",
            minWidth: 168,
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
        </div>
      )}
    </div>
  );
}
