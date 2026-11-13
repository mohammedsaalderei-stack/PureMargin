/* Receipts: today's, or any day's, searchable — and refunds.

   Refunding is choosing lines and how many of each, a reason, and how the
   money goes back. It writes a refund receipt of its own; the sale is never
   changed. A line already refunded in full cannot be refunded again, and the
   server says how many are left of a line partly refunded. */

import { useCallback, useEffect, useState } from "react";
import { Receipt, Search, Printer, Undo2, Minus, Plus, ChevronLeft, Mail } from "lucide-react";
import EmailReceipt from "./EmailReceipt.jsx";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";
import { Btn, Sheet, Row, Empty, Field, money } from "./ui.jsx";
import { call, RegisterError, queued, refusedSales, retryRefused, flush, isNetworkError } from "./api.js";
import { printReceipt, loadPrinters } from "../print/printers.js";
import { printProblem } from "./printText.js";

const DAY = 864e5;
const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

export default function Receipts({ token, catalogue, branchId, can, printCtx, customers, onChanged, queueTick = "" }) {
  const C = useC();
  const { t } = useLang();
  const P = t.pos;
  const [day, setDay] = useState(() => startOfDay(Date.now()));
  const [q, setQ] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(null);
  const sales = (list) => list.filter((e) => e.kind === "sale" && e.body?.branchId === branchId);
  const [pending, setPending] = useState(() => sales(queued()));
  const [refused, setRefused] = useState(() => sales(refusedSales()));
  const refreshLocal = () => { setPending(sales(queued())); setRefused(sales(refusedSales())); };

  const load = useCallback(async () => {
    refreshLocal();
    try {
      const out = await call(token, "receipts", { query: { from: day, to: Math.min(Date.now(), day + DAY - 1), branches: branchId, q } });
      setData(out);
      setError("");
    } catch (err) {
      setError(isNetworkError(err) ? P.errors.network : P.errors.generic);
    }
  }, [token, day, branchId, q, P.errors]);

  /* And again whenever the queue moves: a sale that has just been sent is
     no longer waiting, and is now in the list underneath. */
  useEffect(() => { load(); }, [load, queueTick]);

  const isToday = day === startOfDay(Date.now());

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="p-4 pb-2 space-y-3 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <button onClick={() => setDay((d) => d - DAY)} className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "var(--chip-bg)" }}><ChevronLeft size={18} className="flip-rtl" /></button>
          <div className="text-center">
            <div className="font-bold">{isToday ? P.receipts.today : new Date(day).toLocaleDateString(printCtx.locale, { weekday: "short", day: "numeric", month: "short" })}</div>
            {data && <div className="text-xs data" dir="ltr" style={{ color: C.slate }}>{fill(P.receipts.summary, { n: data.totals.count, total: money(data.totals.total) })}</div>}
          </div>
          <button onClick={() => setDay((d) => Math.min(startOfDay(Date.now()), d + DAY))} disabled={isToday}
            className="w-10 h-10 rounded-full flex items-center justify-center disabled:opacity-30" style={{ background: "var(--chip-bg)" }}><ChevronLeft size={18} className="rotate-180 flip-rtl" /></button>
        </div>
        <div className="flex items-center gap-2 px-3.5 rounded-2xl" style={{ background: "var(--chip-bg)" }}>
          <Search size={16} style={{ color: C.slate }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={P.receipts.search}
            className="flex-1 bg-transparent py-3 text-sm outline-none" style={{ color: C.ink }} />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-6">
        {/* What this device sold and has not managed to send yet — shown here
            because, until it is sent, here is the only place it exists. */}
        {isToday && (pending.length > 0 || refused.length > 0) && (
          <div className="mb-3 space-y-2">
            {[[pending, P.offline.unsent, P.offline.unsentLead, C.amber, false], [refused, P.offline.refused, P.offline.refusedLead, C.rose, true]]
              .filter(([list]) => list.length > 0).map(([list, title, lead, color, canRetry]) => (
                <div key={title} className="rounded-2xl p-3" style={{ border: `1px solid ${color}55`, background: `${color}12` }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold" style={{ color }}>{title} · {list.length}</span>
                    {canRetry && <button onClick={() => { retryRefused(); refreshLocal(); flush(token).catch(() => null).finally(() => { refreshLocal(); load(); onChanged?.(); }); }} className="text-xs font-bold underline" style={{ color }}>{P.offline.retry}</button>}
                  </div>
                  <p className="text-[11px] mt-0.5 mb-1" style={{ color: C.slate }}>{lead}</p>
                  {list.map((e) => (
                    <div key={e.body.clientId || e.at} className="flex items-center justify-between gap-3 py-1 text-xs">
                      <span className="data" dir="ltr">{e.body.number} · {new Date(e.at).toLocaleTimeString(printCtx.locale, { hour: "2-digit", minute: "2-digit" })}</span>
                      <span className="data font-bold" dir="ltr">{money(e.body.receipt?.total_money)}</span>
                    </div>
                  ))}
                </div>
              ))}
          </div>
        )}
        {error && !(pending.length && !data) && <p className="text-sm mb-2" style={{ color: C.rose }}>{error}</p>}
        {!data ? (error ? null : <Empty icon={Receipt} title={P.common.loading} />)
          : !data.receipts.length ? <Empty icon={Receipt} title={P.receipts.none} />
          : data.receipts.map((r) => {
            const refund = r.receipt_type === "REFUND";
            return (
              <button key={r.receipt_number} onClick={() => setOpen(r)} className="w-full flex items-center justify-between gap-3 py-3 text-start" style={{ borderBottom: `1px solid ${C.hairline}` }}>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold data" dir="ltr">{r.receipt_number}</span>
                  <span className="block text-xs" style={{ color: C.slate }}>
                    {new Date(r.receipt_date).toLocaleTimeString(printCtx.locale, { hour: "2-digit", minute: "2-digit" })} · {(r.payments || []).map((p) => p.name).join(" + ")}{r.cashier ? ` · ${r.cashier}` : ""}
                  </span>
                </span>
                <span className="shrink-0 flex items-center gap-2">
                  {/* Made offline and recorded as charged, where that is not
                      what the menu says: somebody should look. */}
                  {Array.isArray(r.review) && r.review.length > 0 && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: "rgba(251,191,36,0.15)", color: C.amber }}>{P.offline.review}</span>}
                  <span className="data font-bold" dir="ltr" style={{ color: refund ? C.rose : C.ink }}>{refund ? "−" : ""}{money(r.total_money)}</span>
                </span>
              </button>
            );
          })}
      </div>
      {open && <ReceiptDetail token={token} number={open.receipt_number} catalogue={catalogue} can={can} printCtx={printCtx} customers={customers}
        onClose={() => setOpen(null)} onRefunded={() => { setOpen(null); load(); onChanged?.(); }} />}
    </div>
  );
}

function ReceiptDetail({ token, number, catalogue, can, printCtx, customers, onClose, onRefunded }) {
  const C = useC();
  const { t } = useLang();
  const P = t.pos;
  const [data, setData] = useState(null);
  const [emailing, setEmailing] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printNote, setPrintNote] = useState("");

  useEffect(() => { call(token, "receipt", { query: { number } }).then(setData).catch(() => setData({ error: true })); }, [token, number]);

  if (!data) return <Sheet title={number} onClose={onClose}><p className="text-sm py-6 text-center" style={{ color: C.slate }}>{P.common.loading}</p></Sheet>;
  if (data.error) return <Sheet title={number} onClose={onClose}><p className="text-sm py-6 text-center" style={{ color: C.rose }}>{P.errors.generic}</p></Sheet>;
  const r = data.receipt;
  const customer = customers.find((c) => c.id === r.customer_id);
  const refundable = r.receipt_type === "SALE" && (r.line_items || []).some((li, i) => li.quantity > (data.refunded.lines[i] || 0));

  if (refunding) return <Refund token={token} receipt={r} refunded={data.refunded.lines} catalogue={catalogue} P={P} onCancel={() => setRefunding(false)} onDone={onRefunded} printCtx={printCtx} />;
  if (emailing) return <EmailReceipt token={token} number={r.receipt_number} initial={customer?.email || ""} onClose={() => setEmailing(false)} />;

  return (
    <Sheet title={r.receipt_type === "REFUND" ? P.receipts.refundReceipt : P.receipts.receipt} onClose={onClose}
      footer={
        <div className="flex gap-2">
          <Btn kind="ghost" disabled={printing || !loadPrinters().some((p) => p.role === "receipt")}
            onClick={async () => {
              setPrinting(true);
              setPrintNote("");
              const results = await printReceipt(r, { ...printCtx, customer }, { copy: true }).catch(() => []);
              const bad = results.find((x) => !x.ok);
              if (bad) setPrintNote(printProblem(P, bad));
              setPrinting(false);
            }}>
            <Printer size={16} />{P.receipts.reprint}
          </Btn>
          <Btn kind="ghost" onClick={() => setEmailing(true)}><Mail size={16} />{P.email.action}</Btn>
          {refundable && can.refund && <Btn full kind="danger" onClick={() => setRefunding(true)}><Undo2 size={16} />{P.receipts.refund}</Btn>}
        </div>
      }>
      <div className="text-xs mb-3 data" dir="ltr" style={{ color: C.slate }}>{r.receipt_number} · {new Date(r.receipt_date).toLocaleString(printCtx.locale)}</div>
      {printNote && <p className="text-xs mb-3 font-semibold" role="status" style={{ color: C.rose }}>{printNote}</p>}
      {r.refund_for && <div className="text-xs mb-2" style={{ color: C.slate }}>{fill(P.receipts.refundOf, { number: r.refund_for })}</div>}
      {Array.isArray(r.review) && r.review.length > 0 && (
        <div className="rounded-2xl p-3 mb-3 text-xs space-y-1" style={{ border: `1px solid ${C.amber}55`, background: `${C.amber}12` }}>
          <div className="font-bold" style={{ color: C.amber }}>{P.offline.reviewLead}</div>
          {r.review.map((code) => (
            <div key={code} style={{ color: C.ink }}>{fill(P.offline.why[code] || code, { total: money(r.review_server_total ?? 0) })}</div>
          ))}
        </div>
      )}
      {customer && <div className="text-sm mb-2 font-semibold">{customer.name}</div>}
      {(r.line_items || []).map((li, i) => (
        <div key={i} className="py-2" style={{ borderBottom: `1px solid ${C.hairline}` }}>
          <Row label={`${li.quantity} × ${li.item_name}${li.variant_name ? ` · ${li.variant_name}` : ""}`} value={money(li.total_money)} />
          {(li.line_modifiers || []).length > 0 && <div className="text-xs" style={{ color: C.slate }}>+ {li.line_modifiers.map((m) => m.name).join(", ")}</div>}
          {data.refunded.lines[i] > 0 && <div className="text-xs" style={{ color: C.rose }}>{fill(P.receipts.alreadyRefunded, { n: data.refunded.lines[i] })}</div>}
        </div>
      ))}
      <div className="pt-2">
        <Row label={P.order.subtotal} value={money(r.subtotal_money)} muted />
        {r.total_discount > 0 && <Row label={P.order.discount} value={`−${money(r.total_discount)}`} muted />}
        <Row label={r.vat_mode === "inclusive" ? fill(P.order.vatIncluded, { pct: r.vat_pct }) : fill(P.order.vat, { pct: r.vat_pct })} value={money(r.total_tax)} muted />
        <Row label={P.charge.total} value={money(r.total_money)} strong big />
        {(r.payments || []).map((p, i) => <Row key={i} label={p.name} value={money(p.money_amount)} muted />)}
      </div>
    </Sheet>
  );
}

function Refund({ token, receipt, refunded, catalogue, P, onCancel, onDone, printCtx }) {
  const C = useC();
  const [qty, setQty] = useState(() => Object.fromEntries((receipt.line_items || []).map((li, i) => [i, 0])));
  const [reason, setReason] = useState("");
  const [type, setType] = useState(receipt.payments?.[0]?.payment_type_id || catalogue.paymentTypes?.[0]?.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const left = (i) => receipt.line_items[i].quantity - (refunded[i] || 0);
  const lines = Object.entries(qty).filter(([, n]) => n > 0).map(([i, n]) => ({ index: Number(i), qty: n }));
  /* What goes back, VAT and all, worked out the way `buildRefund` does. */
  const net = lines.reduce((s, l) => s + (receipt.line_items[l.index].total_money * l.qty) / receipt.line_items[l.index].quantity, 0);
  const saleNet = receipt.line_items.reduce((s, li) => s + Number(li.total_money), 0);
  const amount = receipt.vat_mode === "inclusive" || !saleNet ? net : net + (Number(receipt.total_tax || 0) * net) / saleNet;

  const go = async () => {
    setBusy(true);
    setError("");
    try {
      const out = await call(token, "refund", { method: "POST", body: { number: receipt.receipt_number, lines, reason, paymentType: type } });
      await printReceipt(out.receipt, printCtx, { openDrawer: out.receipt.payments?.[0]?.type === "CASH", auto: true }).catch(() => {});
      onDone();
    } catch (err) {
      setError(err instanceof RegisterError ? (P.errors[err.body?.error] || P.errors.generic) : P.errors.network);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={P.refund.title} onClose={onCancel}
      footer={
        <div className="space-y-2">
          {error && <p className="text-sm" style={{ color: C.rose }}>{error}</p>}
          <Btn full size="lg" kind="danger" disabled={busy || !lines.length || !reason.trim()} onClick={go}>
            {fill(P.refund.confirm, { amount: money(amount) })}
          </Btn>
        </div>
      }>
      <div className="flex gap-2 mb-3">
        <Btn kind="ghost" size="sm" onClick={() => setQty(Object.fromEntries(receipt.line_items.map((_, i) => [i, left(i)])))}>{P.refund.all}</Btn>
      </div>
      {receipt.line_items.map((li, i) => (
        <div key={i} className="flex items-center justify-between gap-3 py-2.5" style={{ borderBottom: `1px solid ${C.hairline}`, opacity: left(i) ? 1 : 0.4 }}>
          <span className="min-w-0">
            <span className="block text-sm font-semibold truncate">{li.item_name}{li.variant_name ? ` · ${li.variant_name}` : ""}</span>
            <span className="block text-xs" style={{ color: C.slate }}>{fill(P.refund.left, { n: left(i) })}</span>
          </span>
          <span className="flex items-center gap-1.5" dir="ltr">
            <button disabled={!qty[i]} onClick={() => setQty({ ...qty, [i]: qty[i] - 1 })} className="w-8 h-8 rounded-full flex items-center justify-center disabled:opacity-30" style={{ background: "var(--chip-bg)" }}><Minus size={14} /></button>
            <span className="w-6 text-center data font-bold">{qty[i]}</span>
            <button disabled={qty[i] >= left(i)} onClick={() => setQty({ ...qty, [i]: qty[i] + 1 })} className="w-8 h-8 rounded-full flex items-center justify-center disabled:opacity-30" style={{ background: "var(--chip-bg)" }}><Plus size={14} /></button>
          </span>
        </div>
      ))}
      <div className="mt-4">
        <Field label={P.refund.reason} value={reason} onChange={setReason} placeholder={P.refund.reasonHint} />
        <span className="block text-xs font-semibold mb-1.5" style={{ color: C.slate }}>{P.refund.method}</span>
        <div className="flex flex-wrap gap-2">
          {(catalogue.paymentTypes || []).map((p) => (
            <button key={p.id} onClick={() => setType(p.id)} className="px-4 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: type === p.id ? C.ink : "var(--chip-bg)", color: type === p.id ? C.surface : C.ink }}>{p.name}</button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
