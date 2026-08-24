import { useState } from "react";
import { Truck } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang } from "../i18n.jsx";
import { DirhamMark } from "../Dirham.jsx";

/* Recording a delivery against an order.

   The form opens with every outstanding line pre-filled at the quantity still
   owed and the price agreed, because the overwhelmingly common case is "it all
   turned up as agreed" and that should be one button. What differs is what gets
   typed over: a short delivery, a price that moved.

   The invoice's discount and charges sit at the bottom with a sentence saying
   what happens to them — they are apportioned onto the lines by value, so stock
   carries the landed cost. Buyers are used to systems that quietly drop those, so
   the behaviour is stated rather than assumed. */

export default function ReceiveForm({ order, busy, error, onReceive, onCancel }) {
  const C = useC();
  const { t } = useLang();
  const s = t.inventory.purchasing;

  const outstanding = (order.summary?.outstanding || []).map((o) => {
    const line = order.lines.find((l) => l.ingredientId === o.ingredientId);
    return { ...o, unitPrice: line?.unitPrice ?? 0, orderedUnit: line?.unit };
  });

  const [rows, setRows] = useState(
    outstanding.map((o) => ({
      ingredientId: o.ingredientId,
      name: o.name,
      qty: String(o.qty),
      unit: o.unit,
      unitPrice: String(o.unitPrice),
    }))
  );
  const [invoice, setInvoice] = useState({ invoiceNo: "", discount: "", charges: "" });

  const set = (index, patch) =>
    setRows((r) => r.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const goods = rows.reduce((sum, r) => sum + (Number(r.qty) || 0) * (Number(r.unitPrice) || 0), 0);
  const net = goods + (Number(invoice.charges) || 0) - (Number(invoice.discount) || 0);

  const field = {
    className: "w-full px-2.5 py-2 rounded-lg text-sm",
    style: { background: C.bone, border: `1px solid ${C.hairline}`, color: C.ink },
  };
  const money = (n) => (
    <span className="inline-flex items-baseline gap-[0.22em] tabular-nums" dir="ltr">
      <DirhamMark />{n.toLocaleString(undefined, { maximumFractionDigits: 2 })}
    </span>
  );

  const submit = (e) => {
    e.preventDefault();
    onReceive({
      invoiceNo: invoice.invoiceNo,
      discount: Number(invoice.discount) || 0,
      charges: Number(invoice.charges) || 0,
      /* An empty quantity means "this line didn't come" rather than zero. */
      lines: rows
        .filter((r) => r.qty !== "" && Number(r.qty) > 0)
        .map((r) => ({
          ingredientId: r.ingredientId,
          qty: Number(r.qty),
          unit: r.unit,
          unitPrice: Number(r.unitPrice),
        })),
    });
  };

  return (
    <form onSubmit={submit} className="mt-4 p-4 rounded-lg" style={{ background: "var(--chip-bg)" }}>
      <div className="text-xs font-semibold mb-3" style={{ color: C.slate }}>{s.receive}</div>

      <div className="space-y-2">
        {rows.map((row, index) => (
          <div key={row.ingredientId}>
            <div className="text-sm font-semibold truncate-safe">{row.name}</div>
            <div className="grid grid-cols-3 gap-2 mt-1">
              <input {...field} type="number" min="0" step="any" dir="ltr" placeholder={s.qty}
                value={row.qty} onChange={(e) => set(index, { qty: e.target.value })} />
              <input {...field} dir="ltr" value={row.unit}
                onChange={(e) => set(index, { unit: e.target.value })} />
              <input {...field} type="number" min="0" step="any" dir="ltr" placeholder={s.unitPrice}
                value={row.unitPrice} onChange={(e) => set(index, { unitPrice: e.target.value })} />
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-2 md:grid-cols-3 mt-4">
        <input {...field} placeholder={s.invoiceNo} value={invoice.invoiceNo}
          onChange={(e) => setInvoice({ ...invoice, invoiceNo: e.target.value })} />
        <input {...field} type="number" min="0" step="any" dir="ltr" placeholder={s.discount}
          value={invoice.discount} onChange={(e) => setInvoice({ ...invoice, discount: e.target.value })} />
        <input {...field} type="number" min="0" step="any" dir="ltr" placeholder={s.charges}
          value={invoice.charges} onChange={(e) => setInvoice({ ...invoice, charges: e.target.value })} />
      </div>
      <p className="text-[11px] mt-2" style={{ color: C.slate }}>{s.chargesHint}</p>

      <div className="flex items-center justify-between mt-3 text-sm font-bold">
        <span>{s.invoiced}</span>
        {money(net)}
      </div>

      {error && <p className="text-sm mt-3" style={{ color: C.rose }}>{error}</p>}

      <div className="flex flex-wrap gap-2 mt-4">
        <button type="submit" disabled={busy}
          className="px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
          style={{ background: C.iris, color: C.onPrimary }}>
          <Truck size={14} className="flip-rtl" /> {busy ? s.receiving : s.receive}
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
