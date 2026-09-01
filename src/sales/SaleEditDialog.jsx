import { useEffect, useRef, useState } from "react";
import { X, Loader2, Ban, RotateCcw } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";
import { Money } from "../Dirham.jsx";
import useBackToClose from "../useBackToClose.js";

/* Correcting one sale.

   Two things a person actually wants here, and they are different enough to be
   two modes rather than one form with a checkbox:

   The sale should not count at all — a duplicate, a training transaction, an
   order rung up and never served. That is a void, and nothing else needs
   filling in.

   The sale happened but the figure is wrong. Then the question is which
   figure: a single line rung up at the wrong price, or a total that is wrong
   for a reason the lines cannot show (a discount applied on paper, tax charged
   at the wrong rate). Both are offered, and neither is required.

   A reason is required in every case. Not for tidiness: a corrected figure is
   money removed from the record, and "why" is the first question anyone asks
   about one three months later. Making it optional means it is almost never
   there when it is needed. */

export default function SaleEditDialog({ open, sale, busy, error, onClose, onSave, onRestore }) {
  const C = useC();
  const { t } = useLang();
  const s = t.sales;

  const [mode, setMode] = useState("correct");
  const [reason, setReason] = useState("wrongamount");
  const [note, setNote] = useState("");
  const [total, setTotal] = useState("");
  const [lines, setLines] = useState({});
  const [touched, setTouched] = useState(false);

  const close = useRef(onClose);
  close.current = onClose;
  useBackToClose(open, () => close.current());

  useEffect(() => {
    if (!open) return undefined;
    const edit = sale?.edit;
    setMode(edit?.voided ? "void" : "correct");
    setReason(edit?.reason || "wrongamount");
    setNote(edit?.note || "");
    setTotal(edit?.total != null ? String(edit.total) : "");
    setLines(edit?.lines || {});
    setTouched(false);

    const onKey = (e) => { if (e.key === "Escape") close.current(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, sale]);

  if (!open || !sale) return null;

  const tillLines = sale.till?.lines || [];
  const patchLine = (i, patch) =>
    setLines((prev) => ({ ...prev, [String(i)]: { ...(prev[String(i)] || {}), ...patch } }));

  const changedLines = Object.entries(lines).filter(([, l]) =>
    l && (l.voided || l.qty !== undefined || l.amount !== undefined));

  /* The same refusal the server makes, said before the round trip: a
     correction with nothing in it is not a correction. */
  const empty = mode === "correct" && !changedLines.length && total.trim() === "";

  const submit = () => {
    setTouched(true);
    if (empty) return;
    onSave(mode === "void"
      ? { voided: true, reason, note }
      : {
        voided: false,
        reason,
        note,
        total: total.trim() === "" ? null : Number(total),
        lines: Object.fromEntries(changedLines.map(([i, l]) => [i, {
          voided: Boolean(l.voided),
          qty: l.qty === undefined || l.qty === "" ? null : Number(l.qty),
          amount: l.amount === undefined || l.amount === "" ? null : Number(l.amount),
        }])),
      });
  };

  const field = {
    className: "rounded-lg px-2.5 py-1.5 text-sm outline-none",
    style: { background: C.bone, border: `1px solid ${C.hairline}`, color: C.ink },
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
      style={{ background: C.scrim, backdropFilter: "blur(3px)" }}
      onClick={onClose}>
      <div className="palette-in w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl"
        style={{ background: C.surface, border: `1px solid ${C.hairline}` }}
        onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">

        <div className="flex items-center justify-between px-5 py-4 sticky top-0"
          style={{ background: C.surface, borderBottom: `1px solid ${C.hairline}` }}>
          <div>
            <h3 className="display font-bold text-base">{s.editTitle}</h3>
            <p className="text-[11px]" style={{ color: C.slate }}>
              {fill(s.receiptRef, { id: sale.id })}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={s.cancel}
            className="p-1 rounded-lg" style={{ color: C.slate }}>
            <X size={17} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* What the till said. Always visible while correcting, because the
              whole judgement is a comparison against it. */}
          <div className="rounded-xl p-3" style={{ background: "var(--chip-bg)" }}>
            <div className="text-[11px] mb-2" style={{ color: C.slate }}>{s.tillSaid}</div>
            <div className="flex justify-between text-sm font-bold">
              <span>{s.total}</span>
              <span className="data"><Money value={sale.till?.total || 0} /></span>
            </div>
          </div>

          <div className="flex rounded-xl p-1 gap-1"
            style={{ background: C.bone, border: `1px solid ${C.hairline}` }}>
            {["correct", "void"].map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m}
                className="flex-1 rounded-lg py-2 text-xs font-semibold"
                style={mode === m
                  ? { background: m === "void" ? C.rose : C.iris, color: C.onPrimary }
                  : { background: "transparent", color: C.slate }}>
                {m === "void" ? s.modeVoid : s.modeCorrect}
              </button>
            ))}
          </div>

          {mode === "void" && (
            <div className="rounded-xl p-3 flex gap-2.5" style={{ background: C.irisWash }}>
              <Ban size={15} className="shrink-0 mt-0.5" style={{ color: C.rose }} />
              <p className="text-xs" style={{ color: C.ink }}>{s.voidNote}</p>
            </div>
          )}

          {mode === "correct" && (
            <>
              <div>
                <div className="text-xs font-semibold mb-2" style={{ color: C.slate }}>{s.linesTitle}</div>
                <div className="space-y-2">
                  {tillLines.map((li, i) => {
                    const patch = lines[String(i)] || {};
                    const voided = Boolean(patch.voided);
                    return (
                      <div key={i} className="rounded-xl p-2.5" style={{ background: "var(--chip-bg)" }}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`text-xs font-medium flex-1 min-w-0 truncate${voided ? " line-through" : ""}`}
                            style={voided ? { color: C.slate } : undefined}>
                            {li.name}
                          </span>
                          <button type="button" onClick={() => patchLine(i, { voided: !voided })}
                            className="text-[11px] font-semibold px-2 py-1 rounded-lg"
                            style={{ color: voided ? C.iris : C.rose, border: `1px solid ${C.hairline}` }}>
                            {voided ? s.lineKeep : s.lineRemove}
                          </button>
                        </div>
                        {!voided && (
                          <div className="flex gap-2">
                            <input {...field} type="number" min="0" step="any" inputMode="decimal" dir="ltr"
                              className={`${field.className} w-20 text-end`}
                              aria-label={s.qty}
                              placeholder={String(li.qty)}
                              value={patch.qty ?? ""}
                              onChange={(e) => patchLine(i, { qty: e.target.value })} />
                            <input {...field} type="number" min="0" step="0.01" inputMode="decimal" dir="ltr"
                              className={`${field.className} flex-1 text-end`}
                              aria-label={s.amount}
                              placeholder={String(li.amount)}
                              value={patch.amount ?? ""}
                              onChange={(e) => patchLine(i, { amount: e.target.value })} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="text-[11px] mt-2" style={{ color: C.slate }}>{s.linesHint}</p>
              </div>

              <div>
                <div className="text-xs font-semibold mb-1.5" style={{ color: C.slate }}>{s.totalOverride}</div>
                <input {...field} type="number" min="0" step="0.01" inputMode="decimal" dir="ltr"
                  className={`${field.className} w-full text-end`}
                  placeholder={String(sale.till?.total ?? "")}
                  value={total}
                  onChange={(e) => setTotal(e.target.value)} />
                <p className="text-[11px] mt-1.5" style={{ color: C.slate }}>{s.totalOverrideHint}</p>
              </div>
            </>
          )}

          <div>
            <div className="text-xs font-semibold mb-1.5" style={{ color: C.slate }}>{s.reason}</div>
            <select {...field} className={`${field.className} w-full`}
              value={reason} onChange={(e) => setReason(e.target.value)}>
              {(sale.reasons || ["wrongamount", "wrongitem", "duplicate", "notcompleted", "training", "other"])
                .map((r) => <option key={r} value={r}>{s.reasons[r]}</option>)}
            </select>
          </div>

          <div>
            <div className="text-xs font-semibold mb-1.5" style={{ color: C.slate }}>{s.note}</div>
            <input {...field} className={`${field.className} w-full`}
              placeholder={s.notePlaceholder}
              value={note} maxLength={300}
              onChange={(e) => setNote(e.target.value)} />
          </div>

          {touched && empty && <p className="text-xs" style={{ color: C.rose }}>{s.errEmpty}</p>}
          {error && <p className="text-xs" style={{ color: C.rose }}>{error}</p>}
        </div>

        <div className="flex gap-2 px-5 pb-5">
          {sale.edit && (
            <button type="button" onClick={onRestore} disabled={busy}
              className="rounded-xl px-3 py-2.5 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
              style={{ border: `1px solid ${C.hairline}`, color: C.slate }}>
              <RotateCcw size={13} /> {s.restore}
            </button>
          )}
          <button type="button" onClick={onClose}
            className="flex-1 rounded-xl py-2.5 text-sm font-semibold"
            style={{ border: `1px solid ${C.hairline}`, color: C.ink }}>
            {s.cancel}
          </button>
          <button type="button" onClick={submit} disabled={busy}
            className="flex-1 rounded-xl py-2.5 text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ background: mode === "void" ? C.rose : C.iris, color: C.onPrimary }}>
            {busy && <Loader2 size={14} className="animate-spin" />}
            {mode === "void" ? s.confirmVoid : s.save}
          </button>
        </div>
      </div>
    </div>
  );
}
