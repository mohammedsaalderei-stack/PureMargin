import { useC } from "../theme.jsx";
import { useLang } from "../i18n.jsx";
import { DirhamMark } from "../Dirham.jsx";

/* Which branch leaked the most, and why.

   The document's second success question, answered in one table an owner can read
   in a few seconds: the branch, its food cost against target, its waste, its
   unaccounted money, and the ingredients carrying it. Coverage is printed per row,
   because a branch with half its menu costed will always look flattering. */

export default function BranchRanking({ rows, branchNames, targets }) {
  const C = useC();
  const { t } = useLang();
  const s = t.plan;

  const money = (n) => (
    <span className="inline-flex items-baseline gap-[0.22em] tabular-nums" dir="ltr">
      {n < 0 && "−"}<DirhamMark />{Math.abs(Math.round(n || 0)).toLocaleString()}
    </span>
  );

  return (
    <div className="panel p-5 md:p-6">
      <h3 className="display font-bold text-base">{s.ranking}</h3>
      <p className="text-xs mt-1 mb-4" style={{ color: C.slate }}>{s.rankingNote}</p>

      <div className="space-y-2">
        {rows.map((row) => {
          const over = (row.overTarget || 0) > 0;
          return (
            <div key={row.branchId} className="p-3 rounded-lg" style={{ background: "var(--chip-bg)" }}>
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <span className="text-sm font-semibold">{branchNames[row.branchId] || row.branchId}</span>
                {row.actualCostPct !== null && (
                  <span className="text-xs" style={{ color: over ? C.rose : C.slate }} dir="ltr">
                    {s.foodCost} {row.actualCostPct}% ·{" "}
                    {fill(over ? s.overTarget : s.underTarget, { pts: Math.abs(row.overTarget) })}
                    {` (${targets.foodCostPct}%)`}
                  </span>
                )}
              </div>

              <div className="flex gap-4 mt-1.5 text-[11px]" style={{ color: C.slate }}>
                <span>{s.wasteCol} {money(row.waste)}</span>
                <span>{s.leakCol} {money(row.unexplained)}</span>
              </div>

              {row.drivers.length > 0 && (
                <div className="text-[11px] mt-1" style={{ color: C.slate }}>
                  {row.drivers.map((d) => d.name).join(" · ")}
                </div>
              )}

              {row.recipeCoverage < 1 && (
                <p className="text-[11px] mt-1" style={{ color: C.rose }}>
                  {fill(s.coverageWarn, { pct: Math.round(row.recipeCoverage * 100) })}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
