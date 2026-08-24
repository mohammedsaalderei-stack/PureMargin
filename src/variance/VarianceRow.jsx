import { AlertTriangle } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang } from "../i18n.jsx";
import { DirhamMark } from "../Dirham.jsx";

/* One ingredient's story: what the recipes expected, what the store gave up, and
   how much of the gap somebody wrote down.

   Expanded, it shows the decomposition and the provenance — which dishes drove the
   expectation, how many ledger entries the actual rests on, and the branch split.
   That chain is what makes the headline number arguable in the good sense: a
   manager can check it rather than believe it. */

export default function VarianceRow({ row, open, onToggle, branchNames }) {
  const C = useC();
  const { t } = useLang();
  const s = t.variance;

  const money = (n) => (
    <span className="inline-flex items-baseline gap-[0.22em] tabular-nums" dir="ltr">
      {n < 0 && "−"}<DirhamMark />
      {Math.abs(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
    </span>
  );
  /* Quantities are shown in the ingredient's own stock unit where the base unit
     would be unreadable — 12000 g means nothing to a chef holding 12 kg. */
  const qty = (base) => {
    const grams = row.baseUnit === "g" || row.baseUnit === "ml";
    const value = grams && Math.abs(base) >= 1000 ? base / 1000 : base;
    const unit = grams && Math.abs(base) >= 1000 ? (row.baseUnit === "g" ? "kg" : "l") : (row.baseUnit || row.stockUnit || "");
    return `${Number(value.toFixed(2)).toLocaleString()} ${unit}`;
  };

  const leaking = (row.unexplainedBase || 0) > 0;

  return (
    <div className="rounded-lg" style={{ background: "var(--chip-bg)", border: `1px solid ${open ? C.iris : "transparent"}` }}>
      <button onClick={onToggle} className="w-full flex items-center gap-3 p-3 text-start">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold truncate-safe">{row.name}</span>
            {!row.priced && <AlertTriangle size={12} className="shrink-0" style={{ color: C.rose }} />}
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: C.slate }} dir="ltr">
            {s.expected} {qty(row.theoreticalBase)} · {s.used} {qty(row.actualBase)}
            {row.variancePct !== null && ` · ${row.variancePct > 0 ? "+" : ""}${row.variancePct}%`}
          </div>
        </div>
        <div className="text-end shrink-0">
          {row.value.unexplained === null ? (
            <span className="text-[11px]" style={{ color: C.rose }}>—</span>
          ) : (
            <div className="text-sm font-bold" style={{ color: leaking ? C.rose : C.ink }}>
              {money(row.value.unexplained)}
            </div>
          )}
          <div className="text-[10px]" style={{ color: C.slate }}>{s.leak}</div>
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              [s.expected, row.theoreticalBase, row.value.theoretical],
              [s.used, row.actualBase, row.value.actual],
              [s.waste, row.wasteBase, row.value.waste],
              [s.correction, row.adjustmentBase, row.value.adjustment],
            ].map(([label, base, value]) => (
              <div key={label} className="p-2.5 rounded-lg" style={{ background: C.bone }}>
                <div className="text-[10px] uppercase tracking-wide" style={{ color: C.slate }}>{label}</div>
                <div className="text-xs font-semibold mt-0.5" dir="ltr">{qty(base)}</div>
                {value !== null && (
                  <div className="text-[10px] mt-0.5" style={{ color: C.slate }}>{money(value)}</div>
                )}
              </div>
            ))}
          </div>

          {!row.priced && (
            <p className="text-[11px]" style={{ color: C.rose }}>{s.noValue}</p>
          )}

          {row.drivers.length > 0 && (
            <div className="text-[11px]" style={{ color: C.slate }}>
              {s.drivers}: {row.drivers.map((d) => `${d.name} (${qty(d.qtyBase)})`).join(" · ")}
            </div>
          )}

          {Object.keys(row.byBranch).length > 1 && (
            <div className="text-[11px]" style={{ color: C.slate }}>
              {s.branchSplit}:{" "}
              {Object.entries(row.byBranch).map(([id, b]) =>
                `${branchNames[id] || id} ${qty(b.consumed + b.waste + b.adjustment)}`).join(" · ")}
            </div>
          )}

          <div className="text-[11px]" style={{ color: C.slate }}>
            {row.movements > 0 ? fill(s.movements, { n: row.movements }) : s.noMovements}
          </div>
        </div>
      )}
    </div>
  );
}
