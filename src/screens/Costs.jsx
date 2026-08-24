import { useEffect, useState } from "react";
import { Receipt, Sparkles } from "lucide-react";
import PhotoScan from "../ai/PhotoScan.jsx";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";
import { Money } from "../Dirham.jsx";

/* The bill scanner — the cashier's screen.

   Photograph a printed bill; the AI reads the lines, matches them to the
   menu, and prices each one against the owner's entered costs, so the cost
   and profit of that sale land without any typing. A line the AI can't
   match is handed back: the cashier picks the menu item and enters the
   amount, and the maths is done the same way. */

export default function Costs({ token }) {
  const C = useC();
  const { t } = useLang();
  const s = t.costs;

  const [result, setResult] = useState(null);
  /* The menu with unit costs, for pricing manual picks. */
  const [menu, setMenu] = useState([]);
  const [manual, setManual] = useState({});

  useEffect(() => {
    (async () => {
      try {
        const [mRes, cRes] = await Promise.all([
          fetch("/api/metrics", { headers: { Authorization: `Bearer ${token}` } }),
          fetch("/api/costs", { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        if (!mRes.ok) return;
        const m = await mRes.json();
        const overrides = cRes.ok ? (await cRes.json()).costs || {} : {};
        setMenu((m.items || []).map((i) => ({
          name: i.name,
          price: i.qty > 0 ? Math.round((i.revenue / i.qty) * 100) / 100 : 0,
          cost: overrides[i.name] || i.cost || 0,
        })));
      } catch { /* the scanner still works; manual matching just has no list */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const money = (n) => (n === null || n === undefined ? "—" : <Money value={Math.round(n * 100) / 100} />);

  /* Manually resolved lines, priced from the menu list. */
  const resolved = Object.entries(manual)
    .filter(([, v]) => v.item && Number(v.amount) > 0)
    .map(([text, v]) => {
      const entry = menu.find((m) => m.name === v.item);
      const amount = Number(v.amount);
      const cost = entry?.cost ? entry.cost * (Number(v.qty) || 1) : null;
      return { text, menuItem: v.item, qty: Number(v.qty) || 1, amount, cost, profit: cost !== null ? amount - cost : null };
    });

  const allLines = result
    ? [...(result.lines || []).filter((l) => l.menuItem), ...resolved]
    : [];
  const totalCost = allLines.reduce((sum, l) => (l.cost !== null && sum !== null ? sum + l.cost : null), 0);
  const totalAmount = allLines.reduce((sum, l) => sum + (l.amount || 0), 0);

  const unmatched = (result?.unmatched || []).filter((text) => !manual[text]?.item || !(Number(manual[text]?.amount) > 0));

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto w-full">
        <div>
          <h2 className="display font-bold text-xl flex items-center gap-2">
            <Sparkles size={18} style={{ color: C.iris }} /> {s.title}
          </h2>
          <p className="text-sm mt-1" style={{ color: C.slate }}>{s.lead}</p>
        </div>

        <div className="panel p-5 md:p-6">
          <PhotoScan token={token} kind="bill" buttonLabel={s.scan}
            onResult={(r) => { setResult(r); setManual({}); }} />
        </div>

        {result && (
          <>
            {result.summary && (
              <div className="panel p-4 flex gap-2.5">
                <Sparkles size={15} className="shrink-0 mt-0.5" style={{ color: C.iris }} />
                <p className="text-sm" style={{ color: C.ink }}>{result.summary}</p>
              </div>
            )}

            <div className="panel p-5 md:p-6">
              <h3 className="display font-bold text-base mb-3 flex items-center gap-2">
                <Receipt size={15} style={{ color: C.iris }} /> {s.linesTitle}
              </h3>

              <div className="space-y-1.5">
                {(result.lines || []).map((l, i) => (
                  <div key={i} className="flex items-center gap-3 py-2 px-3 rounded-lg text-sm"
                    style={{ background: "var(--chip-bg)" }}>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{l.menuItem || l.text}</div>
                      {l.menuItem && l.text !== l.menuItem && (
                        <div className="text-[11px] truncate" style={{ color: C.slate }}>{l.text}</div>
                      )}
                    </div>
                    <span className="data text-xs shrink-0" style={{ color: C.slate }} dir="ltr">×{l.qty || 1}</span>
                    <span className="data text-xs shrink-0 w-16 text-end">{money(l.amount)}</span>
                    <span className="data text-xs shrink-0 w-16 text-end" style={{ color: C.slate }}>{money(l.cost)}</span>
                    <span className="data text-xs font-semibold shrink-0 w-16 text-end"
                      style={{ color: l.profit === null ? C.slate : l.profit >= 0 ? C.iris : C.rose }}>
                      {money(l.profit)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-3 mt-1 px-3">
                <span className="text-[10px] uppercase tracking-wide w-16 text-end" style={{ color: C.slate }}>{s.amount}</span>
                <span className="text-[10px] uppercase tracking-wide w-16 text-end" style={{ color: C.slate }}>{s.cost}</span>
                <span className="text-[10px] uppercase tracking-wide w-16 text-end" style={{ color: C.slate }}>{s.profit}</span>
              </div>

              {/* Lines the AI couldn't place: the cashier resolves them by hand. */}
              {unmatched.length > 0 && (
                <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${C.hairline}` }}>
                  <div className="text-xs font-semibold mb-1">{s.unmatchedTitle}</div>
                  <p className="text-[11px] mb-3" style={{ color: C.slate }}>{s.unmatchedNote}</p>
                  {unmatched.map((text) => (
                    <div key={text} className="flex flex-wrap items-center gap-2 py-2">
                      <span className="text-xs flex-1 min-w-[120px]" style={{ color: C.slate }}>{text}</span>
                      <select
                        value={manual[text]?.item || ""}
                        onChange={(e) => setManual({ ...manual, [text]: { ...(manual[text] || {}), item: e.target.value } })}
                        className="px-2 py-1.5 rounded-lg text-xs max-w-[160px]"
                        style={{ border: `1px solid ${C.hairline}`, background: "transparent", color: C.ink }}>
                        <option value="">{s.pickItem}</option>
                        {menu.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
                      </select>
                      <input
                        type="number" min="0" step="0.01" inputMode="decimal"
                        placeholder={s.amountPlaceholder}
                        value={manual[text]?.amount || ""}
                        onChange={(e) => setManual({ ...manual, [text]: { ...(manual[text] || {}), amount: e.target.value } })}
                        className="w-24 px-2 py-1.5 rounded-lg text-xs"
                        style={{ border: `1px solid ${C.hairline}`, background: "transparent", color: C.ink }} dir="ltr" />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* The answer: what the bill was worth after cost. */}
            <div className="panel p-5 md:p-6">
              <div className="grid grid-cols-3 gap-2">
                {[
                  [s.total, result.total ?? totalAmount, null],
                  [s.totalCost, resolved.length ? totalCost : result.totalCost, null],
                  [s.totalProfit,
                    resolved.length && totalCost !== null && result.total != null
                      ? result.total - totalCost
                      : result.totalProfit,
                    C.iris],
                ].map(([label, value, tone]) => (
                  <div key={label} className="p-3 rounded-lg" style={{ background: "var(--chip-bg)" }}>
                    <div className="text-[10px] uppercase tracking-wide" style={{ color: C.slate }}>{label}</div>
                    <div className="text-base font-bold mt-0.5" style={tone ? { color: tone } : undefined}>
                      {money(value)}
                    </div>
                  </div>
                ))}
              </div>
              {(result.totalCost === null || unmatched.length > 0) && (
                <p className="text-[11px] mt-3" style={{ color: C.slate }}>
                  {fill(s.partialNote, { n: unmatched.length })}
                </p>
              )}
            </div>
          </>
        )}

        {!result && (
          <div className="text-center py-10">
            <Receipt size={30} className="mx-auto mb-3" style={{ color: C.slate, opacity: 0.5 }} />
            <p className="text-sm" style={{ color: C.slate }}>{s.empty}</p>
          </div>
        )}
      </div>
    </div>
  );
}
