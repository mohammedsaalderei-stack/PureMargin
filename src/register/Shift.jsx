/* The shift: what the drawer should hold, and closing it.

   While the shift is open this is its running report — sales by payment
   type, discounts, refunds, and the cash that ought to be in the drawer. Cash
   put in or taken out without a sale is recorded here with a reason. Closing
   is counting the drawer: the difference between what is there and what
   should be is shown before anything is confirmed, and printed with the
   report for the cash bag. */

import { useState } from "react";
import { Wallet, ArrowDownToLine, ArrowUpFromLine, Printer, Lock, History, Inbox } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";
import { Btn, Tile, Sheet, Row, Empty, Keypad, keyInto, Field, money } from "./ui.jsx";

/* An amount taken off, shown with its minus only when there is one. */
const less = (n) => (Number(n) > 0 ? `−${money(n)}` : money(0));
import { call, RegisterError } from "./api.js";
import { printShift, openDrawer } from "../print/printers.js";

export default function Shift({ token, branchId, shift, summary, onChanged, printCtx, business, catalogue, stale = false }) {
  const C = useC();
  const { t } = useLang();
  const P = t.pos;
  const [move, setMove] = useState(null);
  const [closing, setClosing] = useState(false);
  const [history, setHistory] = useState(null);
  const [notice, setNotice] = useState("");

  const say = (text) => { setNotice(text); setTimeout(() => setNotice(""), 3000); };

  if (!catalogue.useShifts) {
    return <Empty icon={Wallet} title={P.shift.offTitle} lead={P.shift.offLead} />;
  }
  if (shift === undefined) return <Empty icon={Wallet} title={P.common.loading} />;
  if (!shift) {
    return <Empty icon={Wallet} title={P.shift.noneTitle} lead={P.shift.noneLead}
      action={<Btn kind="ghost" onClick={async () => setHistory((await call(token, "shifts").catch(() => ({ shifts: [] }))).shifts)}><History size={15} />{P.shift.history}</Btn>} />;
  }

  const s = summary;
  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="rounded-3xl p-5" style={{ background: C.surface, border: `1px solid ${C.hairline}` }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold" style={{ color: C.slate }}>
              {fill(P.shift.openedBy, { by: shift.openedBy || "—", time: new Date(shift.openedAt).toLocaleTimeString(printCtx.locale, { hour: "2-digit", minute: "2-digit" }) })}
            </span>
            <span className="text-xs px-2.5 py-1 rounded-full font-bold" style={{ background: "rgba(52,211,153,0.14)", color: C.mint }}>{P.status.shiftOpen}</span>
          </div>
          <div className="text-xs font-semibold mt-3" style={{ color: C.slate }}>{P.shift.expectedCash}</div>
          <div className="data text-4xl font-extrabold" dir="ltr">{money(s?.cash.expected || 0)}</div>
        </div>

        <div className="grid grid-cols-4 gap-2">
          <Tile icon={ArrowDownToLine} label={P.shift.payIn} onClick={() => setMove("in")} />
          <Tile icon={ArrowUpFromLine} label={P.shift.payOut} onClick={() => setMove("out")} />
          <Tile icon={Inbox} label={P.shift.drawer} onClick={async () => { try { await openDrawer(); } catch { say(P.print.noDrawer); } }} />
          <Tile icon={Printer} label={P.shift.printX} onClick={async () => { const r = await printShift(shift, s, { ...printCtx, business }); if (!r[0]?.ok) say(P.print.failed); }} />
        </div>

        {s && (
          <div className="rounded-3xl p-5" style={{ background: C.surface, border: `1px solid ${C.hairline}` }}>
            <Row label={P.shift.grossSales} value={money(s.grossSales)} />
            <Row label={P.shift.discounts} value={less(s.discounts)} muted />
            <Row label={P.shift.refunds} value={less(s.refunded)} muted />
            <Row label={P.shift.netSales} value={money(s.netSales)} strong />
            <Row label={P.shift.tax} value={money(s.tax)} muted />
            <Row label={P.shift.receipts} value={String(s.receipts)} muted />
            <div className="my-3" style={{ borderTop: `1px solid ${C.hairline}` }} />
            {s.payments.map((p) => <Row key={p.id} label={p.name} value={money(p.amount)} />)}
            <div className="my-3" style={{ borderTop: `1px solid ${C.hairline}` }} />
            <Row label={P.shift.float} value={money(s.cash.float)} muted />
            <Row label={P.shift.cashSales} value={money(s.cash.sales)} muted />
            <Row label={P.shift.cashRefunds} value={less(s.cash.refunds)} muted />
            <Row label={P.shift.payIns} value={money(s.cash.payIns)} muted />
            <Row label={P.shift.payOuts} value={less(s.cash.payOuts)} muted />
            <Row label={P.shift.expectedCash} value={money(s.cash.expected)} strong />
          </div>
        )}

        {/* Ending the shift is the one action here that cannot be taken back,
            so it sits apart and is no louder than it needs to be. */}
        <div className="flex justify-center pt-1">
          <Btn kind="danger" onClick={() => setClosing(true)}><Lock size={15} />{P.shift.close}</Btn>
        </div>
        {notice && <p className="text-sm text-center" style={{ color: C.amber }}>{notice}</p>}
        {/* Figures from before the connection dropped are not today's count. */}
        {stale && <p className="text-xs text-center" style={{ color: C.amber }}>{shift?.pending ? P.offline.shiftOpened : P.offline.savedShift}</p>}
      </div>

      {move && <CashMove token={token} branchId={branchId} type={move} P={P} onClose={() => setMove(null)} onDone={() => { setMove(null); onChanged(); }} />}
      {closing && <CloseShift token={token} branchId={branchId} expected={s?.cash.expected || 0} P={P} printCtx={printCtx} business={business}
        onClose={() => setClosing(false)} onDone={() => { setClosing(false); onChanged(); }} />}
      {history && (
        <Sheet title={P.shift.history} onClose={() => setHistory(null)} wide>
          {!history.length ? <p className="text-sm" style={{ color: C.slate }}>{P.shift.noHistory}</p> : history.map((h) => (
            <div key={h.id} className="py-3" style={{ borderBottom: `1px solid ${C.hairline}` }}>
              <Row label={new Date(h.closedAt).toLocaleString(printCtx.locale)} value={money(h.summary.netSales)} strong />
              <Row label={fill(P.shift.countedBy, { by: h.closedBy || "—" })} value={`${h.difference >= 0 ? "+" : ""}${money(h.difference)}`} muted />
            </div>
          ))}
        </Sheet>
      )}
    </div>
  );
}

function CashMove({ token, branchId, type, P, onClose, onDone }) {
  const C = useC();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const save = async () => {
    try {
      await call(token, "shift-move", { method: "POST", body: { branchId, type, amount: Number(amount), note } });
      if (type === "in" || type === "out") openDrawer().catch(() => {});
      onDone();
    } catch (err) {
      setError(err instanceof RegisterError ? (P.errors[err.body?.error] || P.errors.generic) : P.errors.network);
    }
  };
  return (
    <Sheet title={type === "in" ? P.shift.payIn : P.shift.payOut} onClose={onClose}
      footer={<Btn full size="lg" disabled={!(Number(amount) > 0) || !note.trim()} onClick={save}>{P.common.save}</Btn>}>
      <div className="flex items-center justify-between px-4 py-3 rounded-2xl mb-3" style={{ background: "var(--chip-bg)" }}>
        <span className="text-sm font-semibold" style={{ color: C.slate }}>{P.shift.amount}</span>
        <span className="data text-2xl font-bold" dir="ltr">{amount || "0"}</span>
      </div>
      <Keypad onKey={(k) => setAmount((v) => keyInto(v, k))} />
      <div className="mt-3"><Field label={P.shift.reason} value={note} onChange={setNote} placeholder={P.shift.reasonHint} /></div>
      {error && <p className="text-sm" style={{ color: C.rose }}>{error}</p>}
    </Sheet>
  );
}

function CloseShift({ token, branchId, expected, P, printCtx, business, onClose, onDone }) {
  const C = useC();
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const diff = (Number(counted) || 0) - expected;
  const close = async () => {
    setBusy(true);
    try {
      const out = await call(token, "shift-close", { method: "POST", body: { branchId, counted: Number(counted) || 0, note } });
      await printShift(out.shift, out.shift.summary, { ...printCtx, business }).catch(() => {});
      onDone();
    } catch (err) {
      setError(err instanceof RegisterError ? (P.errors[err.body?.error] || P.errors.generic) : P.errors.network);
      setBusy(false);
    }
  };
  return (
    <Sheet title={P.shift.close} onClose={onClose}
      footer={<Btn full size="lg" kind="danger" disabled={busy || counted === ""} onClick={close}>{P.shift.closeConfirm}</Btn>}>
      <p className="text-sm mb-3" style={{ color: C.slate }}>{P.shift.countLead}</p>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="px-4 py-3 rounded-2xl" style={{ background: "var(--chip-bg)" }}>
          <div className="text-xs font-semibold" style={{ color: C.slate }}>{P.shift.expectedCash}</div>
          <div className="data text-xl font-bold" dir="ltr">{money(expected)}</div>
        </div>
        <div className="px-4 py-3 rounded-2xl" style={{ background: C.irisWash }}>
          <div className="text-xs font-semibold" style={{ color: C.iris }}>{P.shift.counted}</div>
          <div className="data text-xl font-bold" dir="ltr">{counted || "0"}</div>
        </div>
      </div>
      {counted !== "" && (
        <p className="text-sm font-bold mb-3 text-center" style={{ color: Math.abs(diff) < 0.01 ? C.mint : C.amber }}>
          {Math.abs(diff) < 0.01 ? P.shift.balanced : fill(diff > 0 ? P.shift.over : P.shift.short, { amount: money(Math.abs(diff)) })}
        </p>
      )}
      <Keypad onKey={(k) => setCounted((v) => keyInto(v, k))} />
      <div className="mt-3"><Field label={P.shift.note} value={note} onChange={setNote} /></div>
      {error && <p className="text-sm" style={{ color: C.rose }}>{error}</p>}
    </Sheet>
  );
}
