/* The channels a business sells through, and what each one charges.

   A channel's fees are rules with dates. Saving a rule never changes one
   already on file: the list underneath is the whole history, and the one in
   force today is marked. That is what lets an order from March still say
   what March's commission was. */

import { useState } from "react";
import { Plus, ChevronDown, Loader2, Power } from "lucide-react";
import { fill, useLang } from "../i18n.jsx";
import { CHANNEL_PRESETS, EMPTY_RULE, IN_STORE_ID, FEE_BASES, AD_MODELS, DISCOUNT_MODELS } from "../../shared/channelmath.js";
import { today, ruleNow } from "./shared.jsx";

const blank = () => ({ ...Object.fromEntries(Object.entries(EMPTY_RULE).map(([k, v]) => [k, typeof v === "number" ? "" : v])), validFrom: today(), validTo: "", branchId: "" });

export default function ChannelList({ data, T, C, api, onChanged, focus }) {
  const L = T.list;
  const { t } = useLang();
  const [openId, setOpenId] = useState(focus?.channelId || null);
  const [form, setForm] = useState(null);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [minMargin, setMinMargin] = useState(String(data.settings?.minMarginPct ?? ""));
  const can = data.can.manage;
  const have = new Set(data.channels.map((c) => c.preset).filter(Boolean));
  const presets = CHANNEL_PRESETS.filter((p) => !have.has(p.key) && p.key !== "in_store");
  const presetName = (p) => L.presets[p.key] || p.name;
  const nameOf = (c) => (c.id === IN_STORE_ID ? L.presets.in_store : c.name);

  const run = async (fn) => {
    setBusy(true);
    setError("");
    setNote("");
    try { await fn(); await onChanged(); } catch (err) { setError(L.errors[err.code] || L.errors.generic); } finally { setBusy(false); }
  };
  const add = (body) => run(async () => { const out = await api("POST", "channel", body); setCustom(""); setOpenId(out.channel.id); });
  const saveRule = (channelId) => run(async () => {
    await api("POST", "rule", { ...form, channelId, branchId: form.branchId || null });
    setForm(null);
    setNote(L.saved);
  });

  const box = { background: "var(--chip-bg)", color: C.ink, border: `1px solid ${C.hairline}` };
  const numField = (key, hint) => (
    <label key={key} className="block">
      <span className="block text-[11px] font-semibold mb-1" style={{ color: C.slate }}>{L.fields[key]}</span>
      <input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value.replace(/[^\d.]/g, "") })} inputMode="decimal" dir="ltr" placeholder="0"
        className="w-full px-3 py-2.5 rounded-xl text-sm data outline-none" style={box} />
      {hint && <span className="block text-[10.5px] mt-1 leading-snug" style={{ color: C.slate }}>{hint}</span>}
    </label>
  );
  const pick = (key, options, labels) => (
    <label key={key} className="block">
      <span className="block text-[11px] font-semibold mb-1" style={{ color: C.slate }}>{L.fields[key]}</span>
      <select value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={box}>
        {options.map((o) => <option key={o} value={o}>{labels[o]}</option>)}
      </select>
    </label>
  );
  const dateField = (key) => (
    <label key={key} className="block">
      <span className="block text-[11px] font-semibold mb-1" style={{ color: C.slate }}>{L.fields[key]}</span>
      <input type="date" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} dir="ltr"
        className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={box} />
    </label>
  );

  const summary = (rule) => {
    if (!rule || rule === EMPTY_RULE) return L.noRule;
    const parts = [fill(L.summary, { pct: rule.commissionPct })];
    if (rule.paymentFeePct > 0) parts.push(`${L.fields.paymentFeePct} ${rule.paymentFeePct}`);
    if (rule.fixedOrderFee > 0) parts.push(`${L.fields.fixedOrderFee} ${rule.fixedOrderFee}`);
    if (rule.deliveryCostPerOrder > 0) parts.push(`${L.fields.deliveryCostPerOrder} ${rule.deliveryCostPerOrder}`);
    if (rule.advertisingModel !== "none") parts.push(`${L.fields.advertisingModel}: ${L.ads[rule.advertisingModel]}`);
    if (rule.discountModel !== "none") parts.push(`${L.fields.discountModel}: ${rule.discountModel === "percent" ? `${rule.merchantDiscountPct}%` : rule.merchantDiscountFixed}`);
    return parts.join(" · ");
  };
  const branchName = (id) => data.branches.find((b) => b.id === id)?.name || id;

  return (
    <div className="space-y-3">
      {can && (
        <div className="panel p-4">
          <h3 className="display font-bold text-sm mb-3">{L.add}</h3>
          <div className="flex flex-wrap gap-2 mb-3">
            {presets.map((p) => (
              <button key={p.key} onClick={() => add({ preset: p.key, name: presetName(p) })} disabled={busy}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-full text-xs font-semibold" style={{ background: "var(--chip-bg)", color: C.ink }}>
                <Plus size={12} />{presetName(p)}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={L.customName} maxLength={40}
              className="flex-1 min-w-0 px-3.5 py-2.5 rounded-xl text-sm outline-none" style={box} />
            <button onClick={() => add({ name: custom, type: "custom" })} disabled={busy || !custom.trim()}
              className="px-4 rounded-xl text-sm font-semibold disabled:opacity-50" style={{ background: C.iris, color: "#fff" }}>{L.create}</button>
          </div>
          {error && !form && <p className="text-xs mt-2" style={{ color: C.rose }}>{error}</p>}
        </div>
      )}

      {data.channels.map((c) => {
        const rule = ruleNow(c, data.branch);
        const open = openId === c.id;
        const current = (c.rules || []).length ? rule : null;
        const history = [...(c.rules || [])].sort((a, b) => (b.validFrom > a.validFrom ? 1 : b.validFrom < a.validFrom ? -1 : (b.createdAt || 0) - (a.createdAt || 0)));
        return (
          <div key={c.id} className="panel p-4" style={{ opacity: c.active ? 1 : 0.6 }}>
            <button onClick={() => { setOpenId(open ? null : c.id); setForm(null); setError(""); }} className="w-full flex items-center justify-between gap-3 text-start" aria-expanded={open}>
              <span className="min-w-0">
                <span className="block text-sm font-bold truncate">{nameOf(c)}
                  <span className="ms-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "var(--chip-bg)", color: C.slate }}>{c.active ? L.types[c.type] || c.type : L.inactive}</span>
                </span>
                <span className="block text-[11px] mt-0.5 truncate" style={{ color: C.slate }}>{summary(current)}</span>
              </span>
              <ChevronDown size={16} className="shrink-0" style={{ color: C.slate, transform: open ? "rotate(180deg)" : "none" }} />
            </button>

            {open && (
              <div className="mt-3 pt-3 space-y-3" style={{ borderTop: `1px solid ${C.hairline}` }}>
                {can && !form && (
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={() => { setForm({ ...blank(), ...(current ? Object.fromEntries(Object.keys(EMPTY_RULE).map((k) => [k, typeof EMPTY_RULE[k] === "number" ? (current[k] ? String(current[k]) : "") : current[k]])) : {}) }); setError(""); setNote(""); }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold" style={{ background: C.iris, color: "#fff" }}>
                      <Plus size={13} />{L.newRule}
                    </button>
                    {c.id !== IN_STORE_ID && (
                      <button onClick={() => run(() => api("POST", "channel", { id: c.id, active: !c.active }))} disabled={busy}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold" style={{ background: "var(--chip-bg)", color: c.active ? C.rose : C.ink }}>
                        <Power size={13} />{c.active ? L.switchOff : L.switchOn}
                      </button>
                    )}
                  </div>
                )}
                {note && !form && <p className="text-xs font-semibold" style={{ color: C.mint }}>{note}</p>}

                {can && !form && c.id !== IN_STORE_ID && data.branches.length > 1 && (
                  <div>
                    <div className="text-[11px] font-semibold mb-1.5" style={{ color: C.slate }}>{L.branches}</div>
                    <div className="flex flex-wrap gap-2">
                      {data.branches.map((b) => {
                        const on = (c.branches || []).includes(b.id);
                        return (
                          <button key={b.id} disabled={busy} aria-pressed={on}
                            onClick={() => run(() => api("POST", "channel", { id: c.id, branches: on ? c.branches.filter((x) => x !== b.id) : [...(c.branches || []), b.id] }))}
                            className="px-3 py-1.5 rounded-full text-xs font-semibold" style={{ background: on ? C.irisWash : "var(--chip-bg)", color: on ? C.iris : C.ink }}>{b.name}</button>
                        );
                      })}
                    </div>
                    <p className="text-[10.5px] mt-1.5" style={{ color: C.slate }}>{L.branchesHint}</p>
                  </div>
                )}

                {form && (
                  <div className="space-y-3">
                    <p className="text-[11px] leading-relaxed" style={{ color: C.slate }}>{L.ruleNote}</p>
                    <div className="grid grid-cols-2 gap-3">
                      {dateField("validFrom")}{dateField("validTo")}
                    </div>
                    {data.branches.length > 1 && (
                      <label className="block">
                        <span className="block text-[11px] font-semibold mb-1" style={{ color: C.slate }}>{L.fields.branchId}</span>
                        <select value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })} className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={box}>
                          <option value="">{T.allBranches}</option>
                          {data.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                      </label>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      {numField("commissionPct")}{pick("commissionBase", FEE_BASES, L.bases)}
                      {numField("paymentFeePct")}{pick("paymentFeeBase", FEE_BASES, L.bases)}
                      {numField("fixedOrderFee")}{numField("fixedItemFee")}
                    </div>
                    {pick("advertisingModel", AD_MODELS, L.ads)}
                    {form.advertisingModel === "percent" && numField("advertisingPct")}
                    {form.advertisingModel === "per_order_fixed" && numField("advertisingPerOrder")}
                    {form.advertisingModel === "monthly_fixed" && (
                      <div className="grid grid-cols-2 gap-3">{numField("advertisingMonthly")}{numField("expectedMonthlyOrders", L.hints.expectedMonthlyOrders)}</div>
                    )}
                    {pick("discountModel", DISCOUNT_MODELS, L.discounts)}
                    {form.discountModel === "percent" && numField("merchantDiscountPct")}
                    {form.discountModel === "fixed" && numField("merchantDiscountFixed")}
                    <div className="grid grid-cols-2 gap-3">
                      {numField("deliveryCostPerOrder")}{numField("vatOnPlatformFeePct", L.hints.vatOnPlatformFeePct)}
                    </div>
                    {error && <p className="text-xs" style={{ color: C.rose }}>{error}</p>}
                    <div className="flex gap-2">
                      <button onClick={() => saveRule(c.id)} disabled={busy} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50" style={{ background: C.iris, color: "#fff" }}>
                        {busy && <Loader2 size={14} className="animate-spin" />}{L.save}
                      </button>
                      <button onClick={() => { setForm(null); setError(""); }} className="px-4 py-2.5 rounded-xl text-sm font-semibold" style={{ background: "var(--chip-bg)", color: C.slate }}>{L.cancel}</button>
                    </div>
                  </div>
                )}

                {!form && history.length > 0 && (
                  <div>
                    <div className="text-[11px] font-semibold mb-1.5" style={{ color: C.slate }}>{L.history}</div>
                    {history.map((r) => (
                      <div key={r.id} className="py-2 text-xs" style={{ borderTop: `1px solid ${C.hairline}` }}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold" dir="ltr">{L.from} {r.validFrom} {r.validTo ? `${L.to} ${r.validTo}` : `· ${L.open}`}</span>
                          {current && r.id === current.id && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: C.irisWash, color: C.iris }}>{L.current}</span>}
                        </div>
                        <div className="mt-0.5" style={{ color: C.slate }}>
                          {summary(r)}{r.branchId ? ` · ${branchName(r.branchId)}` : ""}{r.createdBy ? ` · ${fill(L.by, { name: r.createdBy })}` : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {can && (
        <div className="panel p-4 flex items-end gap-3">
          <label className="flex-1 block">
            <span className="block text-xs font-semibold mb-1.5" style={{ color: C.slate }}>{L.minMargin}</span>
            <input value={minMargin} onChange={(e) => setMinMargin(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" dir="ltr"
              className="w-full px-3.5 py-2.5 rounded-xl text-sm data outline-none" style={box} />
          </label>
          <button disabled={busy || minMargin === "" || Number(minMargin) === Number(data.settings?.minMarginPct)}
            onClick={() => run(async () => { await api("PUT", "settings", { minMarginPct: Number(minMargin) }); setNote(L.minMarginSaved); })}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40" style={{ background: C.iris, color: "#fff" }}>{t.pos.common.save}</button>
        </div>
      )}
    </div>
  );
}
