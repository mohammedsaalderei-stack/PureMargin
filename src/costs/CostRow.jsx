import { useEffect, useRef, useState } from "react";
import { MoreVertical, Pencil, Trash2, CalendarOff } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang } from "../i18n.jsx";
import { Money } from "../Dirham.jsx";

/* One line of the ledger: what it was, what it cost, and what you can do to it.

   The controls live behind the overflow button rather than sitting on the row
   as icons. On a phone the row is already carrying an icon, a title, a
   subtitle and an amount, and a delete control permanently within thumb reach
   of a scrolling finger is the wrong control to make easy.

   ── Two ways to stop a constant cost ─────────────────────────────────────

   `onEnd` is offered only where it means something, which is the fixed list.
   The two are genuinely different and collapsing them loses information either
   way round.

   Ending closes a cost that really ran. Rent that stopped in March still
   applied in February, and a report over February has to keep costing it — so
   the entry survives with an end date and simply stops counting forwards.
   That is the right answer almost every time.

   Deleting is for the entry that should never have existed: a typo, a
   duplicate, a figure entered against the wrong business. Keeping one of those
   would only ever mislead, because there is no period in which it was true.

   The menu says which is which in plain words rather than offering "delete"
   twice with different consequences. */

export default function CostRow({ icon: Icon, title, subtitle, amount, mayWrite, onEdit, onEnd, onDelete }) {
  const C = useC();
  const { t } = useLang();
  const s = t.costs;
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);

  /* Closed by a click anywhere else, including on another row's button — two
     menus open at once is a state nobody asked for. */
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item = {
    className: "flex items-center gap-2 w-full px-3 py-2 text-xs font-medium text-start",
  };

  return (
    <div className="flex items-center gap-3 py-3 px-3 rounded-xl"
      style={{ background: "var(--chip-bg)" }}>
      <div className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center"
        style={{ background: C.irisWash, color: C.iris }}>
        <Icon size={17} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate">{title}</div>
        {subtitle && (
          <div className="text-[11px] truncate" style={{ color: C.slate }}>{subtitle}</div>
        )}
      </div>

      <div className="shrink-0 text-end">
        <div className="data text-sm font-bold"><Money value={amount} /></div>
      </div>

      {mayWrite && (
        <div className="relative shrink-0" ref={wrap}>
          <button type="button" onClick={() => setOpen((v) => !v)}
            aria-label={s.rowActions} aria-expanded={open}
            className="p-1.5 rounded-lg" style={{ color: C.slate }}>
            <MoreVertical size={16} />
          </button>

          {open && (
            <div className="absolute z-20 top-full mt-1 end-0 rounded-xl overflow-hidden min-w-[8.5rem]"
              style={{ background: C.raised, border: `1px solid ${C.hairline}`, boxShadow: `0 8px 24px ${C.glow}` }}
              role="menu">
              <button type="button" role="menuitem" {...item}
                onClick={() => { setOpen(false); onEdit(); }}
                style={{ color: C.ink }}>
                <Pencil size={13} /> {s.edit}
              </button>
              {onEnd && (
                <button type="button" role="menuitem" {...item}
                  onClick={() => { setOpen(false); onEnd(); }}
                  style={{ color: C.ink, borderTop: `1px solid ${C.hairline}` }}>
                  <CalendarOff size={13} /> {s.end}
                </button>
              )}
              <button type="button" role="menuitem" {...item}
                onClick={() => { setOpen(false); onDelete(); }}
                style={{ color: C.rose, borderTop: `1px solid ${C.hairline}` }}>
                <Trash2 size={13} /> {s.delete}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
