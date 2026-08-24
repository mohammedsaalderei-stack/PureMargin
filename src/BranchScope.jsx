import { useEffect, useRef, useState } from "react";
import { Building2, Check, ChevronDown } from "lucide-react";
import { useC } from "./theme.jsx";
import { useLang } from "./i18n.jsx";

/* The branch scope selector: all branches, a selected group, or one branch.

   Deliberately not a router. Isolation is a security control, so an owner keeps
   one session over the whole organization and narrows the view from here — they
   never "enter" a branch. The server resolves the real scope from the session
   either way; this only says what to ask for.

   It renders nothing for a single-branch account. Somebody running one café
   should never have to learn that branches are a concept. */
export default function BranchScope({ branches = [], selected = [], onChange }) {
  const C = useC();
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  if (branches.length < 2) return null;

  /* Empty selection means every authorized branch — the same convention the
     server uses, so "all" needs no special value. */
  const all = selected.length === 0 || selected.length === branches.length;
  const label = all
    ? t.scope.all
    : selected.length === 1
      ? branches.find((b) => b.id === selected[0])?.name || t.scope.one
      : `${selected.length} ${t.scope.branches}`;

  const toggle = (id) => {
    const base = all ? branches.map((b) => b.id) : selected;
    const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    /* Deselecting everything would show nothing, which nobody means to ask
       for; treat it as going back to all branches. */
    onChange(next.length === 0 || next.length === branches.length ? [] : next);
  };

  return (
    <div className="relative" ref={box}>
      <button onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold"
        style={{ border: `1px solid ${C.hairline}`, color: C.ink }}
        title={t.scope.title}>
        <Building2 size={14} style={{ color: C.slate }} />
        <span className="flex-1 text-start truncate">{label}</span>
        <ChevronDown size={12} style={{ color: C.slate }} />
      </button>

      {open && (
        <div className="absolute bottom-full mb-2 w-full z-30 rounded-xl overflow-hidden py-1"
          style={{ background: "var(--panel-solid, var(--panel-glass))", backdropFilter: "blur(20px)", border: `1px solid ${C.hairline}`, boxShadow: "0 12px 32px rgba(0,0,0,0.18)" }}>
          <button onClick={() => { onChange([]); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-start"
            style={{ color: C.ink }}>
            <span className="w-3.5 shrink-0">{all && <Check size={13} style={{ color: C.iris }} />}</span>
            <span className="flex-1 truncate">{t.scope.all}</span>
            <span className="data text-[10px]" style={{ color: C.slate }} dir="ltr">{branches.length}</span>
          </button>

          <div className="my-1" style={{ borderTop: `1px solid ${C.hairline}` }} />

          {branches.map((b) => {
            const on = !all && selected.includes(b.id);
            return (
              <button key={b.id} onClick={() => toggle(b.id)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-start"
                style={{ color: on ? C.ink : C.slate }}>
                <span className="w-3.5 shrink-0">{on && <Check size={13} style={{ color: C.iris }} />}</span>
                <span className="flex-1 truncate">{b.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
