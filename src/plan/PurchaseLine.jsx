import { useState } from "react";
import { Clock, ChevronDown } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";

/* One purchase recommendation.

   The quantity is never shown alone. Beside it sit the range, the confidence grade
   and — expanded — the assumptions and the arithmetic behind them, because the
   document requires a forecast to disclose all four. An operator who disagrees with
   the number can see exactly which input to argue with. */

const TONE = { high: "cyan", medium: "iris", low: "slate" };

export default function PurchaseLine({ line }) {
  const C = useC();
  const { t } = useLang();
  const s = t.plan;
  const [open, setOpen] = useState(false);

  /* Base units are grams and millilitres; a person orders in kilos and litres. */
  const show = (base) => {
    const grams = base >= 1000 || base <= -1000;
    const unit = line.stockUnit === "kg" || line.stockUnit === "g" ? (grams ? "kg" : "g")
      : line.stockUnit === "l" || line.stockUnit === "ml" ? (grams ? "l" : "ml")
      : line.stockUnit;
    const value = grams && unit !== line.stockUnit ? base / 1000 : base;
    return `${Number(Number(value).toFixed(2)).toLocaleString()} ${unit}`;
  };

  const tone = C[TONE[line.confidence]];

  return (
    <div className="rounded-lg" style={{ background: "var(--chip-bg)" }}>
      <button onClick={() => setOpen(!open)} className="w-full p-3 flex items-center gap-3 text-start">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold truncate-safe">{line.name}</span>
            {line.urgent && (
              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded"
                style={{ background: C.rose, color: C.onPrimary }}>
                <Clock size={10} />{s.urgent}
              </span>
            )}
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: C.slate }} dir="ltr">
            {fill(s.onHand, { qty: Number(line.onHand).toFixed(2), unit: line.stockUnit })}
            {line.coverDays !== null && ` · ${fill(s.cover, { days: line.coverDays })}`}
          </div>
        </div>

        <div className="text-end shrink-0">
          {line.orderBase > 0 ? (
            <>
              <div className="text-sm font-bold" dir="ltr">{show(line.orderBase)}</div>
              <div className="text-[10px]" style={{ color: C.slate }} dir="ltr">
                {fill(s.range, { low: show(line.rangeBase.low), high: show(line.rangeBase.high) })}
              </div>
            </>
          ) : (
            <div className="text-[11px]" style={{ color: C.slate }}>{s.nothing}</div>
          )}
          <div className="text-[10px] mt-0.5" style={{ color: tone }}>{s.confidence[line.confidence]}</div>
        </div>
        <ChevronDown size={14} style={{ color: C.slate, transform: open ? "rotate(180deg)" : "none" }} />
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          {line.packs > 0 && (
            <div className="text-[11px] font-semibold" dir="ltr">
              {fill(s.packs, { packs: line.packs, size: line.packSize, unit: line.purchaseUnit })}
            </div>
          )}

          {line.confidenceReasons.length > 0 && (
            <p className="text-[11px]" style={{ color: C.slate }}>
              {s.confidenceWhy} {line.confidenceReasons.map((r) => s.reasons[r]).join(", ")}.
            </p>
          )}

          <div>
            <div className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: C.slate }}>
              {s.assumptions}
            </div>
            <ul className="mt-1 space-y-0.5">
              {line.assumptions.map((key) => (
                <li key={key} className="text-[11px]" style={{ color: C.slate }}>
                  · {fill(s.assumes[key], { days: line.basis.leadDays })}
                </li>
              ))}
            </ul>
          </div>

          {/* The arithmetic itself, so the recommendation can be checked. */}
          <div className="text-[11px] tabular-nums" style={{ color: C.slate }} dir="ltr">
            {show(line.basis.weeklyMeanBase)}/week ± {show(line.basis.weeklySdBase)} ·{" "}
            {line.basis.weeksWithUsage}/{line.basis.weeks} weeks · {line.basis.days} days
          </div>
        </div>
      )}
    </div>
  );
}
