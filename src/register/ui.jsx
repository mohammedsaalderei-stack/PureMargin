/* The register's own small parts: sheets, buttons, fields, a keypad.

   Sized for a counter: every control is at least 44 points, money is set in
   tabular figures so columns line up, and the primary action of any sheet is
   the widest, lowest thing on it — where a thumb ends up. */

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Delete } from "lucide-react";
import { useC } from "../theme.jsx";

export const money = (n) => (Number(n) || 0).toFixed(2);

/* Closing with the way out shown: `leaving` is true for the moment the sheet
   is sinking away, and `close` calls the real `onClose` once it has. A caller
   that refuses to close (busy, say) gets its sheet back rather than a closed
   one left on screen invisibly. */
export function useExit(onClose, ms = 210) {
  const [leaving, setLeaving] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const close = useCallback((...args) => {
    if (leaving) return;
    const still = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (still) { onClose?.(...args); return; }
    setLeaving(true);
    timer.current = setTimeout(() => {
      onClose?.(...args);
      timer.current = setTimeout(() => setLeaving(false), 60);
    }, ms);
  }, [leaving, onClose, ms]);
  return [leaving, close];
}

export function Sheet({ title, onClose, children, footer, wide = false }) {
  const C = useC();
  const [leaving, close] = useExit(onClose);
  return (
    <div className={`fixed inset-0 z-50 flex items-end own-insets sm:items-center justify-center sm:p-6 ${leaving ? "backdrop-out" : "backdrop-in"}`}
      style={{ background: C.scrim }} onClick={() => close()}>
      <div className={`w-full ${wide ? "sm:max-w-2xl" : "sm:max-w-md"} rounded-t-3xl sm:rounded-3xl max-h-[92dvh] flex flex-col sheet-card ${leaving ? "sheet-out" : "sheet-in"}`}
        style={{ background: C.surface, border: `1px solid ${C.hairline}` }}
        onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="sm:hidden mx-auto mt-2 w-10 h-1 rounded-full shrink-0" style={{ background: C.hairline }} />
        <div className="flex items-center justify-between px-5 pt-3 sm:pt-5 pb-3 shrink-0">
          <h3 className="display font-bold text-lg" style={{ color: C.ink }}>{title}</h3>
          <button onClick={() => close()} className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "var(--chip-bg)", color: C.slate }} aria-label="close">
            <X size={17} />
          </button>
        </div>
        <div className="px-5 pb-4 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="px-5 pt-3 shrink-0" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)", borderTop: `1px solid ${C.hairline}` }}>{footer}</div>}
      </div>
    </div>
  );
}

export function Btn({ children, onClick, kind = "primary", disabled, className = "", type = "button", full = false, size = "md" }) {
  const C = useC();
  const styles = {
    primary: { background: C.iris, color: "#fff" },
    ghost: { background: "var(--chip-bg)", color: C.ink },
    danger: { background: "rgba(244,63,94,0.12)", color: C.rose },
    good: { background: C.mint, color: "#06281c" },
    outline: { background: "transparent", color: C.ink, border: `1px solid ${C.hairline}` },
  };
  const pad = size === "lg" ? "px-5 py-4 text-base" : size === "sm" ? "px-3 py-2 text-xs" : "px-4 py-3 text-sm";
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`${pad} ${full ? "w-full min-w-0 overflow-hidden" : "shrink-0"} rounded-2xl font-bold inline-flex items-center justify-center gap-2 whitespace-nowrap disabled:opacity-40 active:scale-[0.98] transition-transform ${className}`}
      style={styles[kind]}>
      {children}
    </button>
  );
}

export function Field({ label, value, onChange, placeholder, type = "text", inputMode, dir, autoFocus, hint, maxLength }) {
  const C = useC();
  return (
    <label className="block mb-3">
      {label && <span className="block text-xs font-semibold mb-1.5" style={{ color: C.slate }}>{label}</span>}
      <input value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} type={type}
        inputMode={inputMode} dir={dir} autoFocus={autoFocus} maxLength={maxLength}
        className="w-full px-3.5 py-3 rounded-xl text-base outline-none"
        style={{ background: "var(--chip-bg)", color: C.ink, border: `1px solid ${C.hairline}` }} />
      {hint && <span className="block text-[11px] mt-1" style={{ color: C.slate }}>{hint}</span>}
    </label>
  );
}

/* A small square action: icon over a label that may wrap, for a row of
   several on a phone where a word like "Open drawer" would not fit beside
   its neighbours on one line. */
export function Tile({ icon: Icon, label, onClick, kind = "ghost", disabled }) {
  const C = useC();
  const tone = kind === "danger" ? { background: "rgba(244,63,94,0.12)", color: C.rose } : { background: "var(--chip-bg)", color: C.ink };
  return (
    <button onClick={onClick} disabled={disabled}
      className="min-w-0 rounded-2xl px-2 py-3 flex flex-col items-center justify-center gap-1.5 text-[12px] leading-tight font-semibold text-center disabled:opacity-40 active:scale-[0.97] transition-transform"
      style={tone}>
      {Icon && <Icon size={18} />}
      <span className="break-words">{label}</span>
    </button>
  );
}

/* A choice of a few, as one segmented row. */
export function Seg({ options, value, onChange }) {
  const C = useC();
  return (
    <div className="flex p-1 rounded-2xl gap-1" style={{ background: "var(--chip-bg)" }}>
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className="flex-1 min-w-0 px-2 py-2.5 rounded-xl text-[13px] sm:text-sm font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap"
          style={{ background: o.value === value ? C.surface : "transparent", color: o.value === value ? C.ink : C.slate,
            boxShadow: o.value === value ? "0 2px 8px -4px rgba(0,0,0,0.35)" : "none" }}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ label, value, onChange, hint }) {
  const C = useC();
  return (
    <button onClick={() => onChange(!value)} className="w-full flex items-center justify-between gap-3 py-3 text-start">
      <span>
        <span className="block text-sm font-semibold" style={{ color: C.ink }}>{label}</span>
        {hint && <span className="block text-xs mt-0.5" style={{ color: C.slate }}>{hint}</span>}
      </span>
      <span className="w-12 h-7 rounded-full relative shrink-0 transition-colors" style={{ background: value ? C.iris : "var(--chip-bg)", border: `1px solid ${C.hairline}` }}>
        <span className="absolute top-0.5 w-6 h-6 rounded-full bg-white transition-all" style={{ insetInlineStart: value ? 22 : 2 }} />
      </span>
    </button>
  );
}

/* Digits for money and PINs. `decimal` adds a point. */
export function Keypad({ onKey, decimal = true }) {
  const C = useC();
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", decimal ? "." : "", "0", "del"];
  return (
    <div className="grid grid-cols-3 gap-2" dir="ltr">
      {keys.map((k, i) => (k === "" ? <span key={i} /> : (
        <button key={k} onClick={() => onKey(k)} className="h-14 rounded-2xl text-xl font-bold flex items-center justify-center active:scale-95 transition-transform"
          style={{ background: "var(--chip-bg)", color: C.ink }}>
          {k === "del" ? <Delete size={20} /> : k}
        </button>
      )))}
    </div>
  );
}

/* Typing on a keypad into a money string: at most two decimals. */
export function keyInto(value, k, { decimal = true, max = 9 } = {}) {
  const s = String(value || "");
  if (k === "del") return s.slice(0, -1);
  if (k === ".") return !decimal || s.includes(".") ? s : (s || "0") + ".";
  if (s.includes(".") && s.split(".")[1].length >= 2) return s;
  if (s.replace(".", "").length >= max) return s;
  return s === "0" ? k : s + k;
}

export function Row({ label, value, strong, muted, big }) {
  const C = useC();
  return (
    <div className={`flex items-center justify-between gap-3 ${big ? "py-1.5" : "py-1"}`}>
      <span className={`${big ? "text-base" : "text-sm"} ${strong ? "font-bold" : ""}`} style={{ color: muted ? C.slate : C.ink }}>{label}</span>
      <span className={`data ${big ? "text-xl" : "text-sm"} ${strong ? "font-bold" : ""}`} dir="ltr" style={{ color: muted ? C.slate : C.ink }}>{value}</span>
    </div>
  );
}

export function Empty({ icon: Icon, title, lead, action }) {
  const C = useC();
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="max-w-xs text-center">
        {Icon && <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: C.irisWash, color: C.iris }}><Icon size={24} /></div>}
        <p className="font-bold text-base mb-1" style={{ color: C.ink }}>{title}</p>
        {lead && <p className="text-sm mb-5" style={{ color: C.slate }}>{lead}</p>}
        {action}
      </div>
    </div>
  );
}
