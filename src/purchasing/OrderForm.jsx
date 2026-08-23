import { useState } from "react";
import { Plus, X } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang } from "../i18n.jsx";
import { DirhamMark } from "../Dirham.jsx";

/* Raising a purchase order.

   The line editor defaults each row's unit to the item's purchase unit and its
   price to nothing: a buyer knows what a case costs, and pre-filling a price
   would be inventing a number that later shows up as a variance.

   The running total is shown as the lines are typed, because the decision being
   made here is "is this order the right size", and that question can't be
   answered after saving. */

const emptyLine = { ingredientId: "", qty: "", unit: "", unitPrice: "" };

export default function OrderForm({ meta, busy, error, onSave, onCancel }) {
  const C = useC();
  const { t } = useLang();
  const s = t.inventory.purchasing;

  const branches = meta.branches || [];
  const [head, setHead] = useState({
    branchId: branches[0] || "",
    supplierId: "",
    reference: "",
    notes: "",
  });
  const [lines, setLines] = useState([{ ...emptyLine }]);

  const items = meta.ingredients || [];
  const itemById = (id) => items.find((i) => i.id === id);

  const setLine = (index, patch) =>
    setLines((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  /* Choosing an item brings its purchase unit with it — the unit a supplier
     quotes in, which is rarely the unit the kitchen stocks in. */
  const chooseItem = (index, id) => {
    const item = itemById(id);
    setLine(index, { ingredientId: id, unit: item?.purchaseUnit || item?.stockUnit || "" });
  };

  const total = lines.reduce(
    (sum, l) => sum + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0),
    0
  );

  const field = {
    className: "w-full px-2.5 py-2 rounded-lg text-sm",
    style: { background: C.bone, border: `1px solid ${C.hairline}`, color: C.ink },
  };
  const label = (text) => (
    <span className="text-xs font-medium" style={{ color: C.slate }}>{text}</span>
  );

  const submit = (e) => {
    e.preventDefault();
    onSave({
      ...head,
      lines: lines
        .filter((l) => l.ingredientId && l.qty !== "")
        .map((l) => ({
          ingredientId: l.ingredientId,
          qty: Number(l.qty),
          unit: l.unit,
          unitPrice: Number(l.unitPrice) || 0,
        })),
    });
  };

  return (
    <form onSubmit={submit} className="mb-5 pb-5" style={{ borderBottom: `1px solid ${C.hairline}` }}>
      <div className="grid gap-4 md:grid-cols-2 mb-4">
        <label className="block">
          {label(s.branch)}
          <select {...field} className={`${field.className} mt-1`} value={head.branchId}
            onChange={(e) => setHead({ ...head, branchId: e.target.value })}>
            {branches.map((b) => (
              <option key={b} value={b}>{meta.branchNames?.[b] || b}</option>
            ))}
          </select>
        </label>

        <label className="block">
          {label(s.supplier)}
          <select {...field} className={`${field.className} mt-1`} value={head.supplierId}
            onChange={(e) => setHead({ ...head, supplierId: e.target.value })}>
            <option value="">{s.noSupplier}</option>
            {(meta.suppliers || []).map((sup) => (
              <option key={sup.id} value={sup.id}>{sup.name}</option>
            ))}
          </select>
        </label>

        <label className="block">
          {label(s.reference)}
          <input {...field} className={`${field.className} mt-1`} value={head.reference}
            placeholder={s.referencePlaceholder}
            onChange={(e) => setHead({ ...head, reference: e.target.value })} />
        </label>

        <label className="block">
          {label(s.notes)}
          <input {...field} className={`${field.className} mt-1`} value={head.notes}
            onChange={(e) => setHead({ ...head, notes: e.target.value })} />
        </label>
      </div>

      <div className="text-xs font-semibold mb-2" style={{ color: C.slate }}>{s.lines}</div>

      <div className="space-y-2">
        {lines.map((line, index) => {
          const item = itemById(line.ingredientId);
          const lineTotal = (Number(line.qty) || 0) * (Number(line.unitPrice) || 0);
          return (
            <div key={index} className="p-3 rounded-lg" style={{ background: "var(--chip-bg)" }}>
              <div className="flex gap-2 items-start">
                <select {...field} className={`${field.className} flex-1`} value={line.ingredientId}
                  onChange={(e) => chooseItem(index, e.target.value)}>
                  <option value="">{s.chooseItem}</option>
                  {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
                {lines.length > 1 && (
                  <button type="button" onClick={() => setLines((r) => r.filter((_, i) => i !== index))}
                    className="p-2 rounded-lg hover-soft shrink-0" style={{ color: C.slate }}
                    aria-label={s.removeLine}>
                    <X size={14} />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 mt-2">
                <input {...field} type="number" min="0" step="any" dir="ltr" placeholder={s.qty}
                  value={line.qty} onChange={(e) => setLine(index, { qty: e.target.value })} />
                <input {...field} dir="ltr" placeholder={s.unit} value={line.unit}
                  onChange={(e) => setLine(index, { unit: e.target.value })} />
                <input {...field} type="number" min="0" step="any" dir="ltr" placeholder={s.unitPrice}
                  value={line.unitPrice} onChange={(e) => setLine(index, { unitPrice: e.target.value })} />
              </div>

              <div className="flex items-center justify-between mt-2 text-[11px]" style={{ color: C.slate }}>
                <span>{item ? `${s.qty}: ${item.stockUnit}` : ""}</span>
                <span className="inline-flex items-baseline gap-[0.22em] tabular-nums" dir="ltr">
                  <DirhamMark />{lineTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <button type="button" onClick={() => setLines((r) => [...r, { ...emptyLine }])}
        className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg"
        style={{ border: `1px solid ${C.hairline}`, color: C.slate }}>
        <Plus size={12} /> {s.addLine}
      </button>

      <div className="flex items-center justify-between mt-4 text-sm font-bold">
        <span>{s.orderTotal}</span>
        <span className="inline-flex items-baseline gap-[0.22em] tabular-nums" dir="ltr">
          <DirhamMark />{total.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </span>
      </div>

      {error && <p className="text-sm mt-3" style={{ color: C.rose }}>{error}</p>}

      <div className="flex flex-wrap gap-2 mt-4">
        <button type="submit" disabled={busy}
          className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-60"
          style={{ background: C.iris, color: C.onPrimary }}>
          {busy ? s.saving : s.saveDraft}
        </button>
        <button type="button" onClick={onCancel}
          className="px-4 py-2 rounded-lg text-sm font-semibold"
          style={{ border: `1px solid ${C.hairline}`, color: C.slate }}>
          {t.inventory.cancel}
        </button>
      </div>
    </form>
  );
}
