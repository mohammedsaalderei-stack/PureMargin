import { useEffect, useState } from "react";
import { ShoppingCart, AlertTriangle } from "lucide-react";
import PurchaseLine from "../plan/PurchaseLine.jsx";
import BranchRanking from "../plan/BranchRanking.jsx";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";
import { scopeQuery, scopeKey } from "../scopeParam.js";

/* Stage 5 — the operational plan.

   Two decisions, side by side: what to buy before the shelf runs out, and which
   branch to walk into first. Both come from the ledger and recipes the earlier
   phases built, and both carry their own confidence: the plan's headline grade is
   the weakest row's, never the best, and stale sales are stated at the top rather
   than quietly reducing every grade without explanation. */

const HORIZONS = { d3: 3, d7: 7, d14: 14 };

export default function Plan({ token, branches = [] }) {
  const C = useC();
  const { t, fill } = useLang();
  const s = t.plan;

  const [data, setData] = useState(null);
  const [horizon, setHorizon] = useState("d7");
  const [failed, setFailed] = useState("");

  async function load(next = horizon) {
    setFailed("");
    try {
      const res = await fetch(`/api/operations?horizon=${HORIZONS[next]}${scopeQuery(branches)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) { setData(await res.json()); return; }
      const json = await res.json().catch(() => ({}));
      setFailed(json.error || "failed");
    } catch {
      setFailed("failed");
    }
  }

  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey(branches)]);

  /* A failed request is said plainly, with a retry — never a blank screen. */
  if (!data && failed) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="max-w-sm text-center">
          <AlertTriangle size={28} className="mx-auto mb-3" style={{ color: C.rose }} />
          <p className="display font-bold text-lg mb-2">{t.watch.failedTitle}</p>
          <p className="text-sm mb-5" style={{ color: C.slate }}>{s.noSales}</p>
          <button onClick={() => load()} className="gpill gpill-primary px-4 py-2 text-sm font-semibold">
            {t.common.tryAgain}
          </button>
        </div>
      </div>
    );
  }
  if (!data) return null;

  const plan = data.plan;
  const chip = (on) => on
    ? { background: C.iris, color: C.onPrimary }
    : { border: `1px solid ${C.hairline}`, color: C.slate };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto w-full">
      <div>
        <h2 className="display font-bold text-xl">{s.title}</h2>
        <p className="text-sm mt-1" style={{ color: C.slate }}>{s.lead}</p>
      </div>

      {(data.sales?.error || data.sales?.stale) && (
        <div className="panel p-4 flex gap-2.5">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" style={{ color: C.rose }} />
          <p className="text-xs" style={{ color: C.slate }}>
            {data.sales.error === "notconnected" ? s.noSales : s.staleWarn}
          </p>
        </div>
      )}

      {plan && (
        <div className="panel p-5 md:p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h3 className="display font-bold text-base">{s.planTitle}</h3>
              <p className="text-xs mt-1" style={{ color: C.slate }}>
                {fill(s.planNote, { days: plan.horizonDays, weeks: plan.period.weeks })}
              </p>
            </div>
            {plan.confidence && (
              <span className="text-[11px] px-2.5 py-1 rounded-lg font-semibold"
                style={{ background: "var(--chip-bg)", color: C.slate }}>
                {s.confidence[plan.confidence]}
              </span>
            )}
          </div>

          <div className="flex gap-2 mt-3 mb-4">
            <span className="text-[11px] self-center" style={{ color: C.slate }}>{s.horizon}</span>
            {Object.keys(HORIZONS).map((id) => (
              <button key={id} onClick={() => { setHorizon(id); load(id); }}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={chip(horizon === id)}>
                {s.horizons[id]}
              </button>
            ))}
          </div>

          {plan.lines.length === 0 ? (
            <div className="text-center py-8">
              <ShoppingCart size={28} className="mx-auto mb-3" style={{ color: C.slate, opacity: 0.5 }} />
              <p className="text-sm" style={{ color: C.slate }}>{s.emptyPlan}</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {plan.lines.map((line) => <PurchaseLine key={line.ingredientId} line={line} />)}
            </div>
          )}

          {/* Named, not dropped: the gap in the ledger is itself the finding. */}
          {plan.skipped.length > 0 && (
            <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${C.hairline}` }}>
              <div className="text-[11px] font-semibold">{s.skippedTitle}</div>
              <p className="text-[11px] mt-0.5" style={{ color: C.slate }}>{s.skippedNote}</p>
              <p className="text-[11px] mt-1" style={{ color: C.slate }}>
                {plan.skipped.map((i) => i.name).join(", ")}
              </p>
            </div>
          )}
        </div>
      )}

      {data.ranking && data.ranking.length > 0 && (
        <BranchRanking rows={data.ranking} branchNames={data.branchNames || {}} targets={data.targets} />
      )}
    </div>
  );
}
