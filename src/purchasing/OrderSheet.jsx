import { useEffect, useState } from "react";
import { X, Send, Undo2 } from "lucide-react";
import ReceiveForm from "./ReceiveForm.jsx";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";
import { DirhamMark } from "../Dirham.jsx";

/* One purchase order: what was agreed, what has arrived, and what it cost.

   The summary row is the point of the screen. Ordered, invoiced, charges landed
   on cost and price variance are shown side by side rather than netted into a
   single total, because those four numbers answer four different questions — did
   we buy the right amount, what are we paying, what is the invoice's footer doing
   to our food cost, and did the supplier hold their price. */

export default function OrderSheet({ token, id, onClose, onChanged }) {
  const C = useC();
  const { t } = useLang();
  const s = t.inventory.purchasing;

  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [receiving, setReceiving] = useState(false);

  const auth = { Authorization: `Bearer ${token}` };

  async function load() {
    const res = await fetch(`/api/purchasing?what=order&id=${encodeURIComponent(id)}`, { headers: auth });
    if (!res.ok) { setError(s.errors.failed); return; }
    setState(await res.json());
  }

  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* Errors carrying a quantity — over-receipt, over-return — are worded with it,
     so the message names what was actually expected instead of just refusing. */
  const wordError = (out) => {
    const text = s.errors[out.error];
    if (!text) return s.errors.failed;
    if (out.remaining !== undefined) {
      return fill(text, {
        qty: Number(Number(out.remaining).toFixed(4)).toLocaleString(),
        unit: out.unit || "",
      });
    }
    return text;
  };

  async function post(what, body, successNote) {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const res = await fetch(`/api/purchasing?what=${what}`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      const out = await res.json();
      if (!res.ok) { setError(wordError(out)); return false; }
      setState((prev) => ({ ...prev, order: out.order }));
      setNote(successNote || "");
      setReceiving(false);
      onChanged?.();
      return true;
    } catch {
      setError(s.errors.failed);
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;

  const order = state.order;
  const summary = order.summary || {};
  const canManage = state.canManage;
  const receivable = order.status === "open" || order.status === "partial";

  const money = (n) => (
    <span className="inline-flex items-baseline gap-[0.22em] tabular-nums" dir="ltr">
      {n < 0 && "−"}<DirhamMark />
      {Math.abs(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
    </span>
  );
  const num = (n) => Number(Number(n || 0).toFixed(4)).toLocaleString();

  return (
    <div className="panel p-5 md:p-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="display font-bold text-base truncate-safe">
              {order.reference || order.supplierName || s.untitled}
            </h3>
            <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
              style={{ background: C.hairline, color: order.status === "partial" ? C.rose : C.iris }}>
              {s.statuses[order.status]}
            </span>
          </div>
          <p className="text-xs mt-1" style={{ color: C.slate }}>
            {[
              order.supplierName || s.noSupplier,
              fill(s.createdBy, { who: order.createdBy, when: new Date(order.createdAt).toLocaleDateString() }),
            ].join(" · ")}
          </p>
        </div>
        <button onClick={onClose} className="p-2 rounded-lg hover-soft shrink-0" style={{ color: C.slate }}>
          <X size={14} />
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        {[
          [s.ordered, summary.orderedValue],
          [s.invoiced, summary.receivedValue],
          [s.allocated, summary.allocatedValue],
          [s.priceVariance, summary.priceVarianceValue],
        ].map(([label, value]) => (
          <div key={label} className="p-3 rounded-lg" style={{ background: "var(--chip-bg)" }}>
            <div className="text-[10px] uppercase tracking-wide" style={{ color: C.slate }}>{label}</div>
            <div className="text-sm font-bold mt-0.5"
              style={{ color: label === s.priceVariance && value > 0 ? C.rose : C.ink }}>
              {money(value)}
            </div>
          </div>
        ))}
      </div>

      {/* The lines, each showing ordered against received. */}
      <div className="space-y-1.5">
        {order.lines.map((line) => {
          const receivedQty = line.receivedBase / (line.qtyBase / line.qty || 1);
          const short = line.receivedBase + 1e-9 < line.qtyBase;
          return (
            <div key={line.ingredientId} className="flex items-center gap-3 p-3 rounded-lg"
              style={{ background: "var(--chip-bg)" }}>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold truncate-safe">{line.name}</div>
                <div className="text-[11px] mt-0.5" style={{ color: C.slate }} dir="ltr">
                  {num(line.qty)} {line.unit} · {fill(s.agreed, {
                    v: `${num(line.unitPrice)} / ${line.unit}`,
                  })}
                </div>
              </div>
              <div className="text-end shrink-0">
                <div className="text-xs font-semibold tabular-nums" dir="ltr"
                  style={{ color: short ? C.rose : C.ink }}>
                  {num(receivedQty)} / {num(line.qty)} {line.unit}
                </div>
                {line.returnedBase > 0 && (
                  <div className="text-[11px]" style={{ color: C.slate }} dir="ltr">
                    {s.returned}: {num(line.returnedBase / (line.qtyBase / line.qty || 1))} {line.unit}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {summary.fullyReceived && (
        <p className="text-[11px] mt-3" style={{ color: C.slate }}>{s.nothingOutstanding}</p>
      )}

      {/* Deliveries already recorded, with the invoice each was billed on. */}
      {order.receipts.length > 0 && (
        <div className="mt-5">
          <div className="text-xs font-semibold mb-2" style={{ color: C.slate }}>{s.receipts}</div>
          <div className="space-y-1.5">
            {order.receipts.map((receipt) => (
              <div key={receipt.id} className="flex items-center justify-between gap-3 p-3 rounded-lg text-xs"
                style={{ background: "var(--chip-bg)" }}>
                <div className="min-w-0">
                  <div style={{ color: C.ink }}>
                    {fill(s.receiptOf, { n: receipt.lines.length, invoice: receipt.invoiceNo || s.noInvoice })}
                  </div>
                  <div className="mt-0.5" style={{ color: C.slate }}>
                    {new Date(receipt.at).toLocaleString()}
                  </div>
                </div>
                <div className="font-semibold shrink-0">{money(receipt.invoiceTotal)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-sm mt-3" style={{ color: C.rose }}>{error}</p>}
      {note && <p className="text-sm mt-3" style={{ color: C.iris }}>{note}</p>}

      {receiving && canManage && receivable ? (
        <ReceiveForm order={order} busy={busy} error=""
          onReceive={(body) => post("receive", body, s.received)}
          onCancel={() => setReceiving(false)} />
      ) : (
        <div className="flex flex-wrap gap-2 mt-4">
          {canManage && order.status === "draft" && (
            <button onClick={() => post("submit", {})} disabled={busy}
              className="px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
              style={{ background: C.iris, color: C.onPrimary }}>
              <Send size={14} /> {s.submit}
            </button>
          )}

          {canManage && receivable && !summary.fullyReceived && (
            <button onClick={() => { setReceiving(true); setError(""); setNote(""); }}
              className="px-4 py-2 rounded-lg text-sm font-semibold"
              style={{ background: C.iris, color: C.onPrimary }}>
              {s.receive}
            </button>
          )}

          {/* Returns need something to have arrived first. */}
          {canManage && order.receipts.length > 0 && (
            <ReturnControl order={order} busy={busy}
              onReturn={(body) => post("return", body, s.returned2)} />
          )}

          {canManage && !order.receipts.length && order.status !== "cancelled" && (
            <button onClick={() => { if (window.confirm(s.cancelConfirm)) post("cancel", {}); }} disabled={busy}
              className="px-4 py-2 rounded-lg text-sm font-semibold"
              style={{ border: `1px solid ${C.hairline}`, color: C.slate }}>
              {s.cancelOrder}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* Returns are rare and destructive enough to stay folded away, but they belong on
   the order rather than in the movement ledger: the reason a case went back is
   part of this order's story. */
function ReturnControl({ order, busy, onReturn }) {
  const C = useC();
  const { t } = useLang();
  const s = t.inventory.purchasing;

  const returnable = order.lines.filter((l) => l.receivedBase - l.returnedBase > 1e-9);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ingredientId: returnable[0]?.ingredientId || "", qty: "", reason: "" });

  if (!returnable.length) return null;

  const line = returnable.find((l) => l.ingredientId === form.ingredientId) || returnable[0];
  const field = {
    className: "w-full px-2.5 py-2 rounded-lg text-sm",
    style: { background: C.bone, border: `1px solid ${C.hairline}`, color: C.ink },
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5"
        style={{ border: `1px solid ${C.hairline}`, color: C.slate }}>
        <Undo2 size={14} /> {s.returnTitle}
      </button>
    );
  }

  return (
    <div className="w-full p-4 rounded-lg" style={{ background: "var(--chip-bg)" }}>
      <div className="text-xs font-semibold mb-3" style={{ color: C.slate }}>{s.returnTitle}</div>
      <div className="grid gap-2 md:grid-cols-3">
        <select {...field} value={form.ingredientId}
          onChange={(e) => setForm({ ...form, ingredientId: e.target.value })}>
          {returnable.map((l) => <option key={l.ingredientId} value={l.ingredientId}>{l.name}</option>)}
        </select>
        <input {...field} type="number" min="0" step="any" dir="ltr" placeholder={s.returnQty}
          value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
        <input {...field} placeholder={s.returnReason} value={form.reason}
          onChange={(e) => setForm({ ...form, reason: e.target.value })} />
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        <button disabled={busy || !form.qty}
          onClick={() => onReturn({
            ingredientId: line.ingredientId,
            qty: Number(form.qty),
            unit: line.unit,
            reason: form.reason,
          })}
          className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-60"
          style={{ background: C.iris, color: C.onPrimary }}>
          {s.returnAction}
        </button>
        <button onClick={() => setOpen(false)}
          className="px-4 py-2 rounded-lg text-sm font-semibold"
          style={{ border: `1px solid ${C.hairline}`, color: C.slate }}>
          {t.inventory.cancel}
        </button>
      </div>
    </div>
  );
}
