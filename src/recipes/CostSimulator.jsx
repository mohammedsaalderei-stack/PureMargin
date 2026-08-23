import { useState } from "react";
import { FlaskConical } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang } from "../i18n.jsx";
import { DirhamMark } from "../Dirham.jsx";

/* "What if?" — modelled against the live recipe, saved nowhere.

   The document asks for the effect of a price, portion or selling-price change to
   be visible *before* approval, so the answer is shown as before / modelled /
   change rather than as a single new number: a cost with nothing to compare it
   against isn't a decision, it's trivia.

   The server runs the same costing code on an overridden copy, which is why this
   component sends inputs rather than doing arithmetic of its own — a second
   formula here would eventually disagree with the real one. */

export default function CostSimulator({ token, recipe, method, onClose }) {
  const C = useC();
  const { t, fill } = useLang();
  const s = t.recipes;

  const lines = [...(recipe.effective?.lines || []), ...(recipe.effective?.packaging || [])];

  const [prices, setPrices] = useState({});
  const [quantities, setQuantities] = useState({});
  const [sellPrice, setSellPrice] = useState(recipe.sellPrice ?? "");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const field = {
    className: "w-full px-2.5 py-2 rounded-lg text-sm",
    style: { background: C.bone, border: `1px solid ${C.hairline}`, color: C.ink },
  };

  async function run() {
    setBusy(true);
    try {
      /* Prices are typed per stock unit, the way a supplier quotes them, and
         converted to per-base here — the one place the two scales meet. */
      const costOverrides = {};
      for (const line of lines) {
        const typed = Number(prices[line.ingredientId]);
        if (!Number.isFinite(typed) || typed <= 0) continue;
        const perStockUnit = line.qtyBase / line.qty;   // base units in one stock unit
        costOverrides[line.ingredientId] = typed / perStockUnit;
      }
      const qtyOverrides = {};
      for (const [id, value] of Object.entries(quantities)) {
        if (value !== "" && Number(value) >= 0) qtyOverrides[id] = Number(value);
      }

      const res = await fetch("/api/recipes?what=simulate", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          id: recipe.id, method,
          costOverrides, qtyOverrides,
          sellPrice: sellPrice === "" ? undefined : Number(sellPrice),
        }),
      });
      if (res.ok) setResult((await res.json()).simulation);
    } finally {
      setBusy(false);
    }
  }

  const money = (n) => (
    <span className="inline-flex items-baseline gap-[0.22em] tabular-nums" dir="ltr">
      {n < 0 && "−"}<DirhamMark />
      {Math.abs(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
    </span>
  );

  return (
    <div className="mt-4 p-4 rounded-lg" style={{ background: "var(--chip-bg)" }}>
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="text-xs font-semibold" style={{ color: C.slate }}>{s.simTitle}</div>
        <button onClick={onClose} className="text-xs font-semibold" style={{ color: C.slate }}>
          {s.close}
        </button>
      </div>
      <p className="text-[11px] mb-3" style={{ color: C.slate }}>{s.simHint}</p>

      <div className="space-y-3">
        {lines.map((line) => (
          <div key={line.ingredientId} className="grid grid-cols-2 gap-2">
            <input {...field} type="number" min="0" step="any" dir="ltr"
              placeholder={fill(s.simPrice, { name: `${line.name} / ${line.unit}` })}
              value={prices[line.ingredientId] ?? ""}
              onChange={(e) => setPrices({ ...prices, [line.ingredientId]: e.target.value })} />
            <input {...field} type="number" min="0" step="any" dir="ltr"
              placeholder={fill(s.simPortion, { name: `${line.name} (${line.unit})` })}
              value={quantities[line.ingredientId] ?? ""}
              onChange={(e) => setQuantities({ ...quantities, [line.ingredientId]: e.target.value })} />
          </div>
        ))}
        <input {...field} type="number" min="0" step="any" dir="ltr" placeholder={s.simSellPrice}
          value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} />
      </div>

      <button onClick={run} disabled={busy}
        className="mt-3 px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
        style={{ background: C.iris, color: C.onPrimary }}>
        <FlaskConical size={14} /> {s.simRun}
      </button>

      {result && (
        <div className="grid grid-cols-3 gap-2 mt-4">
          {[
            [s.simBefore, result.before.perPortion.total, result.before.margin],
            [s.simAfter, result.after.perPortion.total, result.after.margin],
          ].map(([title, cost, margin]) => (
            <div key={title} className="p-3 rounded-lg" style={{ background: C.bone }}>
              <div className="text-[10px] uppercase tracking-wide" style={{ color: C.slate }}>{title}</div>
              <div className="text-sm font-bold mt-0.5">{money(cost)}</div>
              {margin && (
                <div className="text-[11px] mt-0.5" style={{ color: C.slate }} dir="ltr">
                  {margin.marginPct}% {s.margin}
                </div>
              )}
            </div>
          ))}
          <div className="p-3 rounded-lg" style={{ background: C.bone }}>
            <div className="text-[10px] uppercase tracking-wide" style={{ color: C.slate }}>{s.simDelta}</div>
            <div className="text-sm font-bold mt-0.5"
              style={{ color: result.delta.perPortion > 0 ? C.rose : C.iris }}>
              {money(result.delta.perPortion)}
            </div>
            {result.delta.marginPct !== null && (
              <div className="text-[11px] mt-0.5" dir="ltr"
                style={{ color: result.delta.marginPct < 0 ? C.rose : C.iris }}>
                {result.delta.marginPct > 0 ? "+" : ""}{result.delta.marginPct} pts
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
