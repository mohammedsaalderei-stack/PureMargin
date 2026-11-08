/* Taking the money.

   One payment or several: the bill can be split across cash and card, or
   across two cards, and what is still owed is always the largest number on
   the sheet. Cash shows the change the moment the amount handed over is
   typed, with the usual notes one tap away. A customer with points can spend
   them here, as long as the business runs a loyalty programme.

   Payment is recorded, not taken: the card goes through whatever card
   machine the business already has, and this records that it did. */

import { useMemo, useState } from "react";
import { Banknote, CreditCard, Wallet, Plus, Trash2, Star } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";
import { buildSale } from "../../shared/tillprice.js";
import { Sheet, Btn, Keypad, keyInto, Row, money } from "./ui.jsx";
import { sell, RegisterError } from "./api.js";

const KIND_ICON = { cash: Banknote, card: CreditCard, other: Wallet };
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/* The notes a customer is likely to hand over for a total. */
function quickAmounts(total) {
  const out = new Set([round2(total)]);
  for (const note of [5, 10, 20, 50, 100, 200, 500]) {
    const up = Math.ceil(total / note) * note;
    if (up > total) out.add(up);
    if (out.size >= 4) break;
  }
  return [...out].slice(0, 4);
}

export default function Charge({ token, order, catalogue, preview, customer, branchId, onClose, onDone }) {
  const C = useC();
  const { t } = useLang();
  const P = t.pos;
  const types = catalogue.paymentTypes || [];
  const [paid, setPaid] = useState([]);
  const [type, setType] = useState(types[0]?.id || "cash");
  const [entry, setEntry] = useState("");
  const [usePoints, setUsePoints] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /* Points change the total, so it is priced again with them. */
  const priced = useMemo(() => {
    if (!usePoints) return preview;
    const out = buildSale({ ...order, redeemPoints: usePoints, payments: [{ type: types[0]?.id }] }, {
      catalogue: catalogue.items, vatPct: catalogue.vatPct, vatMode: catalogue.vatMode,
      paymentTypes: types, discounts: catalogue.discounts, loyaltyPct: catalogue.loyaltyPct,
      pointsBalance: customer?.points || 0,
    });
    return out.receipt || preview;
  }, [usePoints, preview, order, catalogue, types, customer]);

  const total = priced.total_money;
  const paidSoFar = round2(paid.reduce((s, p) => s + p.amount, 0));
  const due = round2(total - paidSoFar);
  const kind = types.find((p) => p.id === type)?.kind || "cash";
  const typed = Number(entry) || 0;
  const change = kind === "cash" && typed > due ? round2(typed - due) : 0;

  const finish = async (payments) => {
    setBusy(true);
    setError("");
    try {
      const out = await sell(token, { ...order, branchId, payments, redeemPoints: usePoints || undefined }, catalogue);
      onDone({ ...out, order });
    } catch (err) {
      const code = err instanceof RegisterError ? err.body?.error || err.message : "network";
      setError(P.errors[code] || P.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  /* Pay what is due with the chosen type — the whole of it, or the amount
     typed when that is less (a split). */
  const pay = () => {
    const amount = kind === "cash" ? due : typed > 0 && typed < due ? round2(typed) : due;
    const thisOne = { type, amount, ...(kind === "cash" && typed >= due ? { received: round2(typed) } : {}) };
    if (kind === "cash" && typed > 0 && typed < due) {
      /* Cash short of the bill is a part payment, and the rest is still owed. */
      setPaid((list) => [...list, { type, amount: round2(typed), received: round2(typed) }]);
      setEntry("");
      return;
    }
    const all = [...paid, thisOne];
    if (round2(all.reduce((s, p) => s + p.amount, 0)) >= total - 0.001) finish(all);
    else { setPaid(all); setEntry(""); }
  };

  return (
    <Sheet title={P.charge.title} onClose={busy ? () => {} : onClose} wide
      footer={
        <div className="space-y-2">
          {error && <p className="text-sm" style={{ color: C.rose }}>{error}</p>}
          <Btn full size="lg" disabled={busy || due <= 0} onClick={pay}>
            {busy ? P.charge.recording : kind === "cash" && change > 0
              ? fill(P.charge.payCashChange, { change: money(change) })
              : typed > 0 && typed < due ? fill(P.charge.payPart, { amount: money(typed) }) : fill(P.charge.payAll, { amount: money(due) })}
          </Btn>
        </div>
      }>
      <div className="grid sm:grid-cols-2 gap-5">
        <div>
          <div className="rounded-3xl p-5 mb-4 text-center" style={{ background: C.irisWash }}>
            <div className="text-xs font-semibold mb-1" style={{ color: C.iris }}>{paid.length ? P.charge.remaining : P.charge.total}</div>
            <div className="data text-4xl font-extrabold" dir="ltr" style={{ color: C.ink }}>{money(due)}</div>
            {paid.length > 0 && <div className="text-xs mt-1" style={{ color: C.slate }}>{fill(P.charge.ofTotal, { total: money(total) })}</div>}
          </div>

          <div className="grid grid-cols-2 gap-2 mb-4">
            {types.map((p) => {
              const Icon = KIND_ICON[p.kind] || Wallet;
              const on = p.id === type;
              return (
                <button key={p.id} onClick={() => { setType(p.id); setEntry(""); }}
                  className="flex items-center gap-2 px-3.5 py-3.5 rounded-2xl text-sm font-bold"
                  style={{ background: on ? C.ink : "var(--chip-bg)", color: on ? C.surface : C.ink }}>
                  <Icon size={17} />{p.name}
                </button>
              );
            })}
          </div>

          {paid.length > 0 && (
            <div className="rounded-2xl p-3 mb-3" style={{ border: `1px solid ${C.hairline}` }}>
              {paid.map((p, i) => (
                <div key={i} className="flex items-center justify-between py-1 text-sm">
                  <span>{types.find((x) => x.id === p.type)?.name}</span>
                  <span className="flex items-center gap-2">
                    <span className="data" dir="ltr">{money(p.amount)}</span>
                    <button onClick={() => setPaid((list) => list.filter((_, j) => j !== i))} style={{ color: C.rose }}><Trash2 size={14} /></button>
                  </span>
                </div>
              ))}
            </div>
          )}

          {customer && catalogue.loyaltyPct > 0 && customer.points > 0 && (
            <button onClick={() => setUsePoints(usePoints ? 0 : Math.min(customer.points, preview.total_money))}
              className="w-full flex items-center justify-between px-4 py-3 rounded-2xl text-sm font-semibold mb-3"
              style={{ background: usePoints ? C.irisWash : "var(--chip-bg)", color: usePoints ? C.iris : C.ink }}>
              <span className="flex items-center gap-2"><Star size={15} />{fill(P.charge.usePoints, { points: money(customer.points) })}</span>
              <span className="data" dir="ltr">{usePoints ? `−${money(usePoints)}` : ""}</span>
            </button>
          )}

          <Row label={P.order.subtotal} value={money(priced.subtotal_money)} muted />
          {priced.total_discount > 0 && <Row label={P.order.discount} value={`−${money(priced.total_discount)}`} muted />}
          <Row label={priced.vat_mode === "inclusive" ? fill(P.order.vatIncluded, { pct: priced.vat_pct }) : fill(P.order.vat, { pct: priced.vat_pct })} value={money(priced.total_tax)} muted />
        </div>

        <div>
          <div className="flex items-center justify-between px-4 py-3 rounded-2xl mb-3" style={{ background: "var(--chip-bg)" }}>
            <span className="text-sm font-semibold" style={{ color: C.slate }}>{kind === "cash" ? P.charge.received : P.charge.amount}</span>
            <span className="data text-2xl font-bold" dir="ltr">{entry || money(due)}</span>
          </div>
          {kind === "cash" && (
            <div className="grid grid-cols-4 gap-2 mb-3">
              {quickAmounts(due).map((a) => (
                <button key={a} onClick={() => setEntry(String(a))} className="py-3 rounded-xl text-sm font-bold data" dir="ltr"
                  style={{ background: Number(entry) === a ? C.irisWash : "var(--chip-bg)", color: C.ink }}>{a % 1 ? money(a) : a}</button>
              ))}
            </div>
          )}
          <Keypad onKey={(k) => setEntry((v) => keyInto(v, k))} />
          {kind !== "cash" && (
            <button onClick={() => setEntry("")} className="mt-3 w-full flex items-center justify-center gap-1.5 text-xs font-semibold" style={{ color: C.slate }}>
              <Plus size={13} />{P.charge.splitHint}
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
