/* The price calculator: one item, one channel, and the price that leaves
   what it should.

   Choose the item and the channel; say what profit to aim for — the one the
   counter makes, or a figure of your own; and try any price to see what it
   leaves. Underneath, every step from the listed price down to the profit is
   written out with its own number, so the answer can be checked rather than
   trusted. */

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, ChevronDown } from "lucide-react";
import { fill } from "../i18n.jsx";
import { IN_STORE_ID, itemEconomics, priceFor, statusOf } from "../../shared/channelmath.js";
import { fmt, pct, labelOf, ruleNow, StatusDot } from "./shared.jsx";

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export default function Calculator({ data, T, C, api, onChanged, focus }) {
  const channels = data.channels.filter((c) => c.active && c.id !== IN_STORE_ID);
  const [itemKey, setItemKey] = useState(focus?.itemKey || data.items.find((i) => i.cost !== null)?.key || data.items[0]?.key || "");
  const [channelId, setChannelId] = useState(focus?.channelId || channels[0]?.id || "");
  const item = data.items.find((i) => i.key === itemKey) || null;
  const channel = channels.find((c) => c.id === channelId) || channels[0] || null;
  const listed = channel && item ? data.prices?.[channel.id]?.[item.key] : undefined;

  const [reference, setReference] = useState("");
  const [keep, setKeep] = useState(true);
  const [target, setTarget] = useState("");
  const [absorb, setAbsorb] = useState("0");
  const [discount, setDiscount] = useState("");
  const [perOrder, setPerOrder] = useState("1");
  const [tryPrice, setTryPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(true);

  /* A different item or channel starts from that pair's own figures. */
  useEffect(() => {
    setReference(item ? String(item.price) : "");
    setTryPrice("");
    setDiscount("");
    setNote("");
  }, [itemKey, channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  const calc = useMemo(() => {
    if (!item || !channel) return null;
    const base = ruleNow(channel, data.branch);
    /* A percentage typed here stands in for the rule's own discount; left
       empty, the rule's applies as written. */
    const rule = discount === "" ? base : { ...base, discountModel: num(discount) > 0 ? "percent" : "none", merchantDiscountPct: num(discount) };
    const counter = data.channels.find((c) => c.id === IN_STORE_ID);
    const common = { recipeCost: item.cost, vatPct: data.vatPct, vatMode: data.vatMode };
    const inStore = itemEconomics({ ...common, price: num(reference) || item.price, rule: ruleNow(counter, data.branch) });
    const goal = keep ? inStore.contribution : num(target);
    const orders = Math.max(1, Math.round(num(perOrder)) || 1);
    const recommended = priceFor({ ...common, target: goal, rule, itemsPerOrder: orders, absorbPct: num(absorb) });
    const breakEven = priceFor({ ...common, target: 0, rule, itemsPerOrder: orders });
    const price = num(tryPrice) > 0 ? num(tryPrice) : listed ?? item.price;
    const e = itemEconomics({ ...common, price, rule, itemsPerOrder: orders });
    return {
      rule, inStore, goal, recommended, breakEven, price, e,
      status: item.cost === null ? "unknown" : statusOf({ contribution: e.contribution, marginPct: e.marginPct, target: goal, minMarginPct: data.settings?.minMarginPct || 0 }),
    };
  }, [item, channel, data, reference, keep, target, absorb, discount, perOrder, tryPrice, listed]);

  if (!channels.length) return <p className="panel p-5 text-sm" style={{ color: C.slate }}>{T.compare.noChannels}</p>;
  if (!item) return <p className="panel p-5 text-sm" style={{ color: C.slate }}>{T.compare.noItems}</p>;

  const save = async () => {
    setBusy(true);
    setNote("");
    try {
      await api("PUT", "prices", { channelId: channel.id, prices: [{ itemKey: item.key, price: calc.price, recommended: calc.recommended !== null && Math.abs(calc.recommended - calc.price) < 0.005 }] });
      setNote(T.calc.used);
      await onChanged();
    } catch (err) {
      setNote(T.list.errors[err.code] || T.list.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  const box = { background: "var(--chip-bg)", color: C.ink, border: `1px solid ${C.hairline}` };
  const field = (label, value, onChange, hint, extra = {}) => (
    <label className="block">
      <span className="block text-xs font-semibold mb-1.5" style={{ color: C.slate }}>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" dir="ltr"
        className="w-full px-3.5 py-2.5 rounded-xl text-sm data outline-none" style={box} {...extra} />
      {hint && <span className="block text-[11px] mt-1 leading-snug" style={{ color: C.slate }}>{hint}</span>}
    </label>
  );
  const select = (label, value, onChange, options) => (
    <label className="block">
      <span className="block text-xs font-semibold mb-1.5" style={{ color: C.slate }}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none" style={box}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );

  const { e, rule } = calc;
  const baseName = (key) => T.list.bases[key] || key;
  const steps = [
    ["listed", T.calc.steps.listed, e.listed, false],
    /* The VAT inside the listed price — all of it, including on the part
       discounted away — so the steps add up to the sale exactly. */
    data.vatMode === "inclusive" && e.tax > 0 && ["vat", fill(T.calc.steps.vat, { pct: data.vatPct }), -(e.listed - e.merchantDiscount - e.subtotal), true],
    e.merchantDiscount > 0 && ["discount", T.calc.steps.discount, -e.merchantDiscount, true],
    ["subtotal", T.calc.steps.subtotal, e.subtotal, false, true],
    e.commission > 0 && ["commission", fill(T.calc.steps.commission, { pct: rule.commissionPct, base: `${baseName(rule.commissionBase)} (${fmt(e.commissionBase)})` }), -e.commission, true],
    e.paymentFee > 0 && ["payment", fill(T.calc.steps.payment, { pct: rule.paymentFeePct, base: `${baseName(rule.paymentFeeBase)} (${fmt(e.paymentBase)})` }), -e.paymentFee, true],
    e.advertising > 0 && ["advertising", T.calc.steps.advertising, -e.advertising, true],
    e.fixedFees > 0 && ["fixed", T.calc.steps.fixed, -e.fixedFees, true],
    e.vatOnFees > 0 && ["vatOnFees", T.calc.steps.vatOnFees, -e.vatOnFees, true],
    e.deliveryCost > 0 && ["delivery", T.calc.steps.delivery, -e.deliveryCost, true],
    ["net", T.calc.steps.net, e.netRevenue, false, true],
    item.cost !== null && ["recipe", T.calc.steps.recipe, -e.recipeCost, true],
    item.cost !== null && ["profit", T.calc.steps.profit, e.contribution, false, true],
  ].filter(Boolean);

  const figure = (label, value, strong, color) => (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className={`text-sm ${strong ? "font-bold" : ""}`} style={{ color: strong ? C.ink : C.slate }}>{label}</span>
      <span className={`data ${strong ? "text-lg font-extrabold" : "text-sm font-semibold"}`} dir="ltr" style={{ color: color || C.ink }}>{value}</span>
    </div>
  );

  return (
    <div className="grid gap-3 lg:grid-cols-2 items-start">
      <div className="panel p-4 space-y-3">
        {select(T.calc.item, item.key, setItemKey, data.items.map((i) => [i.key, labelOf(i)]))}
        {select(T.calc.channel, channel.id, setChannelId, channels.map((c) => [c.id, c.name]))}
        {field(T.calc.reference, reference, setReference)}
        <button onClick={() => setKeep((v) => !v)} className="w-full flex items-center justify-between gap-3 text-start" aria-pressed={keep}>
          <span>
            <span className="block text-sm font-semibold">{T.calc.keep}</span>
            <span className="block text-[11px]" style={{ color: C.slate }}>{T.calc.keepHint}</span>
          </span>
          <span className="w-12 h-7 rounded-full relative shrink-0" style={{ background: keep ? C.iris : "var(--chip-bg)", border: `1px solid ${C.hairline}` }}>
            <span className="absolute top-0.5 w-6 h-6 rounded-full bg-white transition-all" style={{ insetInlineStart: keep ? 22 : 2 }} />
          </span>
        </button>
        {!keep && field(T.calc.target, target, setTarget)}
        <div className="grid grid-cols-2 gap-3">
          {field(T.calc.absorb, absorb, setAbsorb)}
          {field(T.calc.discount, discount, setDiscount, null, { placeholder: rule.discountModel === "percent" ? String(rule.merchantDiscountPct) : "0" })}
        </div>
        <p className="text-[11px] leading-snug -mt-1" style={{ color: C.slate }}>{T.calc.absorbHint} {T.calc.discountHint}</p>
        {field(T.calc.perOrder, perOrder, setPerOrder, T.calc.perOrderHint)}
      </div>

      <div className="space-y-3">
        <div className="panel p-4">
          {item.cost === null ? <p className="text-sm" style={{ color: C.slate }}>{T.compare.noCost}</p> : (
            <>
              <div className="rounded-2xl p-4 mb-3 text-center" style={{ background: C.irisWash }}>
                <div className="text-xs font-semibold mb-1" style={{ color: C.iris }}>{T.calc.recommended}</div>
                <div className="data text-3xl font-extrabold" dir="ltr">{calc.recommended === null ? "—" : fmt(calc.recommended)}</div>
                {calc.recommended === null
                  ? <p className="text-[11px] mt-2" style={{ color: C.rose }}>{T.calc.noPrice}</p>
                  : <button onClick={() => setTryPrice(String(calc.recommended))} className="mt-2 text-[11px] font-bold underline" style={{ color: C.iris }}>{T.calc.tryPrice}</button>}
              </div>
              {figure(T.calc.targetProfit, fmt(calc.goal))}
              {figure(T.calc.breakEven, calc.breakEven === null ? "—" : fmt(calc.breakEven))}
            </>
          )}
        </div>

        <div className="panel p-4">
          <div className="flex items-end gap-3 mb-2">
            <div className="flex-1">{field(T.calc.tryPrice, tryPrice, setTryPrice, null, { placeholder: fmt(listed ?? item.price) })}</div>
            {item.cost !== null && <div className="pb-2.5"><StatusDot status={calc.status} C={C} label={T.status[calc.status]} /></div>}
          </div>
          {figure(T.cols.recipeCost, item.cost === null ? "—" : fmt(e.recipeCost))}
          {figure(T.calc.fees, fmt(e.channelCost))}
          {figure(T.calc.net, fmt(e.netRevenue))}
          {item.cost !== null && figure(T.calc.current, fmt(e.contribution), true, e.contribution > 0 ? C.ink : C.rose)}
          {item.cost !== null && figure(T.calc.margin, pct(e.marginPct))}
          {data.can.manage && item.cost !== null && (
            <button onClick={save} disabled={busy || !(calc.price > 0)}
              className="mt-3 w-full inline-flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-bold disabled:opacity-50" style={{ background: C.iris, color: "#fff" }}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}{T.calc.use} · <span className="data" dir="ltr">{fmt(calc.price)}</span>
            </button>
          )}
          {note && <p className="text-xs mt-2 text-center font-semibold" style={{ color: C.mint }}>{note}</p>}
        </div>

        <div className="panel p-4">
          <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between text-sm font-bold" aria-expanded={open}>
            {T.calc.explain}<ChevronDown size={16} style={{ transform: open ? "rotate(180deg)" : "none", color: C.slate }} />
          </button>
          {open && (
            <div className="mt-2">
              {steps.map(([key, label, amount, minus, total]) => (
                <div key={key} className="flex items-center justify-between gap-3 py-1.5" style={total ? { borderTop: `1px solid ${C.hairline}` } : undefined}>
                  <span className={`text-xs ${total ? "font-bold" : ""}`} style={{ color: total ? C.ink : C.slate }}>{label}</span>
                  <span className={`data text-xs ${total ? "font-bold" : ""}`} dir="ltr" style={{ color: minus ? C.slate : C.ink }}>{minus ? `− ${fmt(Math.abs(amount))}` : fmt(amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
