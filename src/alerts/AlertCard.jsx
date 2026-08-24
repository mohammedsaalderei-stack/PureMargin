import { AlertTriangle, Eye, Info } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";
import { DirhamMark } from "../Dirham.jsx";

/* One finding: what happened, the threshold it crossed, what it's worth, and the
   one thing to do about it.

   The action is not decoration — the direction document requires every feature to
   end in an actionable answer, so it is given the same visual weight as the
   number. The sentence is assembled here from the alert's own figures, which is
   why nothing on the server carries English. */

const ICONS = { critical: AlertTriangle, warning: Eye, info: Info };

/* Warnings borrow the cyan accent rather than inventing an amber the palette
   doesn't have: three tones, all from the theme. */
const toneFor = (severity, C) =>
  severity === "critical" ? C.rose : severity === "warning" ? C.cyan : C.slate;

export default function AlertCard({ alert }) {
  const C = useC();
  const { t } = useLang();
  const s = t.alerts;

  const tone = toneFor(alert.severity, C);
  const Icon = ICONS[alert.severity];
  const num = (n, digits = 1) =>
    Number(Number(n || 0).toFixed(digits)).toLocaleString();

  /* Quantities read in the unit the operator uses; the base unit is for
     arithmetic, not for a person. */
  const perDay = () => {
    const base = alert.basis?.perDayBase || 0;
    return base >= 1000 ? `${num(base / 1000)} kg/l` : num(base);
  };

  const said = () => {
    switch (alert.kind) {
      case "foodcost":
        return fill(s.says.foodcost, { actual: alert.actualPct, target: alert.targetPct, theoretical: alert.theoreticalPct });
      case "variance":
        return alert.pct === null ? "" : fill(s.says.variance, { pct: alert.pct, target: alert.targetPct });
      case "stockout":
        return fill(s.says.stockout, { days: num(alert.coverDays), perDay: perDay(), target: alert.targetDays });
      case "reorder":
        return fill(s.says.reorder, { qty: num(alert.qty, 2), unit: alert.unit, point: num(alert.reorderPoint, 2) });
      case "negative":
        return fill(s.says.negative, { qty: num(alert.qty, 2), unit: alert.unit });
      case "slowmoving":
        return fill(s.says.slowmoving, { days: alert.idleDays, target: alert.targetDays });
      case "expiry":
        return alert.daysLeft <= 0
          ? fill(s.says.expiryPast, { shelf: alert.shelfLifeDays })
          : fill(s.says.expiryDue, { days: alert.daysLeft, shelf: alert.shelfLifeDays });
      case "norate":
        return fill(s.says.norate, { days: alert.days });
      default:
        return "";
    }
  };

  return (
    <div className="p-4 rounded-xl" style={{ background: "var(--chip-bg)", borderInlineStart: `3px solid ${tone}` }}>
      <div className="flex items-start gap-3">
        <Icon size={16} className="shrink-0 mt-0.5" style={{ color: tone }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-sm font-semibold">{s.kinds[alert.kind]}</span>
            {alert.subject && <span className="text-sm" style={{ color: C.slate }}>· {alert.subject}</span>}
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded"
              style={{ background: tone, color: C.onPrimary }}>
              {s.severity[alert.severity]}
            </span>
          </div>

          <p className="text-xs mt-1" style={{ color: C.slate }}>{said()}</p>

          {alert.value > 0 && (
            <p className="text-xs mt-1 font-semibold">
              {s.worth.split("{value}").map((part, i) => (
                <span key={i}>
                  {part}
                  {i === 0 && (
                    <span className="inline-flex items-baseline gap-[0.22em] tabular-nums" dir="ltr" style={{ color: tone }}>
                      <DirhamMark />{Math.round(alert.value).toLocaleString()}
                    </span>
                  )}
                </span>
              ))}
            </p>
          )}

          {alert.runsOutAt && (
            <p className="text-[11px] mt-0.5" style={{ color: C.slate }}>
              {fill(s.runsOut, { date: new Date(alert.runsOutAt).toLocaleDateString() })}
            </p>
          )}

          {/* The answer to "what should be done next", which is the point. */}
          <div className="mt-2.5 p-2.5 rounded-lg" style={{ background: C.bone }}>
            <div className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: C.slate }}>{s.action}</div>
            <p className="text-xs mt-0.5">{s.actions[alert.action]}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
