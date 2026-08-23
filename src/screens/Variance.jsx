import { useEffect, useState } from "react";
import { Scale, AlertTriangle } from "lucide-react";
import VarianceRow from "../variance/VarianceRow.jsx";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";
import { scopeQuery, scopeKey } from "../scopeParam.js";
import { DirhamMark } from "../Dirham.jsx";

/* Where the margin went — stage 4, phase 6.

   The screen answers the document's third success question directly: what is the
   difference between theoretical and actual consumption, and what is it worth. So
   the headline is not "food cost", it is the **unexplained** money — the part that
   waste records and stock counts don't already account for.

   Everything the answer rests on is shown next to it, not buried: the period, the
   cost basis, how much of the sales revenue has a recipe behind it, which sold
   items have none, and when the sales were last read. A leakage figure computed
   over half a menu is a rumour, and the screen has to say which one it is. */

const DAY = 864e5;
const PERIODS = { d7: 7, d30: 30, d90: 90 };

export default function Variance({ token, branches = [] }) {
  const C = useC();
  const { t } = useLang();
  const s = t.variance;

  const [data, setData] = useState(null);
  const [period, setPeriod] = useState("d30");
  const [method, setMethod] = useState("wavg");
  const [openId, setOpenId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState("");

  async function load(nextPeriod = period, nextMethod = method) {
    setLoading(true);
    setFailed("");
    try {
      const to = Date.now();
      const from = to - PERIODS[nextPeriod] * DAY;
      const res = await fetch(`/api/variance?from=${from}&to=${to}&method=${nextMethod}${scopeQuery(branches)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setData(await res.json());
      else setFailed((await res.json().catch(() => ({}))).error || "failed");
    } catch {
      setFailed("failed");
    } finally {
      setLoading(false);
    }
  }

  /* The scope selector is a different question, so a change of it refetches. */
  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey(branches)]);

  /* A failed request is said plainly, with a retry — never a blank screen. */
  if (!data && failed) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="max-w-sm text-center">
          <AlertTriangle size={28} className="mx-auto mb-3" style={{ color: C.rose }} />
          <p className="display font-bold text-lg mb-2">{t.watch.failedTitle}</p>
          <p className="text-sm mb-5" style={{ color: C.slate }}>{s.salesMissing}</p>
          <button onClick={() => load()} className="gpill gpill-primary px-4 py-2 text-sm font-semibold">
            {t.common.tryAgain}
          </button>
        </div>
      </div>
    );
  }
  if (!data) return null;

  const money = (n, tone) => (
    <span className="inline-flex items-baseline gap-[0.22em] tabular-nums" dir="ltr" style={tone ? { color: tone } : undefined}>
      {n < 0 && "−"}<DirhamMark />
      {Math.abs(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
    </span>
  );

  const q = data.quality;
  const coveragePct = Math.round((q.recipeCoverage || 0) * 100);
  const chip = (on) => on
    ? { background: C.iris, color: C.onPrimary }
    : { border: `1px solid ${C.hairline}`, color: C.slate };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto w-full">
      <div>
        <h2 className="display font-bold text-xl">{s.title}</h2>
        <p className="text-sm mt-1" style={{ color: C.slate }}>{s.lead}</p>
      </div>

      {/* Period and cost basis: both change the answer, so both are visible. */}
      <div className="panel p-4 flex flex-wrap gap-4">
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: C.slate }}>{s.period}</div>
          <div className="flex gap-2">
            {Object.keys(PERIODS).map((id) => (
              <button key={id} onClick={() => { setPeriod(id); load(id, method); }}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={chip(period === id)}>
                {s.periods[id]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: C.slate }}>{s.basis}</div>
          <div className="flex gap-2">
            {["wavg", "last"].map((id) => (
              <button key={id} onClick={() => { setMethod(id); load(period, id); }}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={chip(method === id)}>
                {t.recipes.methods[id]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* The headline: what the difference is worth, and what already explains it. */}
      <div className="panel p-5 md:p-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            [s.theoretical, data.totals.theoretical, null],
            [s.actual, data.totals.actual, null],
            [s.wasteTotal, data.totals.waste, null],
            [s.unexplained, data.totals.unexplained, data.totals.unexplained > 0 ? C.rose : null],
          ].map(([label, value, tone]) => (
            <div key={label} className="p-3 rounded-lg" style={{ background: "var(--chip-bg)" }}>
              <div className="text-[10px] uppercase tracking-wide" style={{ color: C.slate }}>{label}</div>
              <div className="text-sm font-bold mt-0.5">{money(value, tone)}</div>
            </div>
          ))}
        </div>

        {data.totals.theoreticalCostPct !== null && (
          <p className="text-[11px] mt-3" style={{ color: C.slate }}>
            {s.costPct}: {fill(s.costPctNote, {
              th: data.totals.theoreticalCostPct,
              ac: data.totals.actualCostPct,
              revenue: Math.round(data.totals.revenue).toLocaleString(),
            })}
          </p>
        )}
      </div>

      {/* Data quality before detail: it decides whether the detail means anything. */}
      <div className="panel p-5 md:p-6">
        <div className="text-xs font-semibold mb-2" style={{ color: C.slate }}>{s.qualityTitle}</div>
        <p className="text-[11px]" style={{ color: coveragePct < 100 ? C.rose : C.slate }}>
          {fill(s.coverage, { pct: coveragePct })}
          {coveragePct < 100 && ` ${s.coverageLow}`}
        </p>

        {q.unmatched.length > 0 && (
          <div className="mt-3">
            <div className="text-[11px] font-semibold" style={{ color: C.ink }}>{s.unmatchedTitle}</div>
            <p className="text-[11px] mt-0.5" style={{ color: C.slate }}>
              {s.unmatchedNote} {q.unmatched.map((u) => u.name).join(", ")}
            </p>
          </div>
        )}

        {q.unpricedCount > 0 && (
          <div className="mt-3">
            <div className="text-[11px] font-semibold" style={{ color: C.ink }}>{s.unpricedTitle}</div>
            <p className="text-[11px] mt-0.5" style={{ color: C.slate }}>
              {fill(s.unpricedNote, { n: q.unpricedCount })} {q.unpriced.map((u) => u.name).join(", ")}
            </p>
          </div>
        )}

        {(data.sales?.error || data.sales?.limitedHistory) && (
          <div className="flex gap-2.5 mt-3 p-3 rounded-lg" style={{ border: `1px solid ${C.rose}` }}>
            <AlertTriangle size={15} className="shrink-0 mt-0.5" style={{ color: C.rose }} />
            <p className="text-[11px]" style={{ color: C.slate }}>
              {data.sales.error === "notconnected" ? s.salesNotConnected
                : data.sales.error ? s.salesMissing
                : s.salesLimited}
            </p>
          </div>
        )}

        {data.sales?.at && (
          <p className="text-[11px] mt-3" style={{ color: C.slate }}>
            {fill(s.syncedAt, { when: new Date(data.sales.at).toLocaleString() })}
          </p>
        )}
      </div>

      <div className="panel p-5 md:p-6">
        <h3 className="display font-bold text-base">{s.itemsTitle}</h3>
        <p className="text-xs mt-1 mb-4" style={{ color: C.slate }}>{s.itemsNote}</p>

        {data.items.length === 0 ? (
          <div className="text-center py-8">
            <Scale size={28} className="mx-auto mb-3" style={{ color: C.slate, opacity: 0.5 }} />
            <p className="text-sm" style={{ color: C.slate }}>{loading ? "" : s.empty}</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {data.items.map((row) => (
              <VarianceRow key={row.ingredientId} row={row}
                open={openId === row.ingredientId}
                onToggle={() => setOpenId(openId === row.ingredientId ? null : row.ingredientId)}
                branchNames={data.branchNames || {}} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
