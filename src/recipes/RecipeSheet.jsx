import { useState } from "react";
import { X, AlertTriangle, FlaskConical, Pencil, Archive, Trash2 } from "lucide-react";
import CostSimulator from "./CostSimulator.jsx";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";
import { DirhamMark } from "../Dirham.jsx";

/* One recipe, costed: where each line's money comes from.

   Every line shows what it draws from stock — not what the recipe says — because
   the draw is the number that leaves the store and the difference between the two
   is preparation yield doing its job. A line with no price behind it is marked
   rather than shown as zero, and the panel says plainly that the total is a lower
   bound when any line is missing. */

export default function RecipeSheet({ token, recipe, method, canManage, onClose, onEdit, onArchive, onDelete }) {
  const C = useC();
  const { t } = useLang();
  const s = t.recipes;

  const [simulating, setSimulating] = useState(false);

  const costing = recipe.costing;
  const money = (n) => (
    <span className="inline-flex items-baseline gap-[0.22em] tabular-nums" dir="ltr">
      <DirhamMark />{Math.abs(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
    </span>
  );
  const num = (n) => Number(Number(n || 0).toFixed(4)).toLocaleString();

  const Line = ({ line }) => (
    <div className="flex items-center gap-3 p-3 rounded-lg" style={{ background: "var(--chip-bg)" }}>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold truncate-safe">{line.name}</div>
        <div className="text-[11px] mt-0.5" style={{ color: C.slate }} dir="ltr">
          {num(line.qty)} {line.unit}
          {line.drawBase !== line.qtyBase && ` · ${fill(s.draws, { qty: num(line.drawBase), unit: line.baseUnit })}`}
        </div>
      </div>
      <div className="text-end shrink-0">
        {line.cost === null ? (
          <span className="text-[11px]" style={{ color: C.rose }}>{s.neverPriced}</span>
        ) : (
          <>
            <div className="text-xs font-semibold">{money(line.cost)}</div>
            <div className="text-[10px]" style={{ color: C.slate }}>
              {fill(s.priced, { n: line.receipts })}
            </div>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="panel p-5 md:p-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h3 className="display font-bold text-base truncate-safe">
            {recipe.menuItem}{recipe.variant ? ` · ${recipe.variant}` : ""}
          </h3>
          <p className="text-xs mt-1" style={{ color: C.slate }}>
            {recipe.effective
              ? [
                  fill(s.version, { n: recipe.effective.version }),
                  fill(s.inForce, { date: new Date(recipe.effective.effectiveFrom).toLocaleDateString() }),
                  fill(s.versionsCount, { n: recipe.versions.length }),
                ].join(" · ")
              : s.noVersion}
          </p>
        </div>
        <button onClick={onClose} className="p-2 rounded-lg hover-soft shrink-0" style={{ color: C.slate }}>
          <X size={14} />
        </button>
      </div>

      {costing && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
            {[
              [s.foodCost, costing.perPortion.foodCost, C.ink],
              [s.packagingCost, costing.perPortion.packagingCost, C.ink],
              [s.totalCost, costing.perPortion.total, C.ink],
              ...(recipe.margin
                ? [[s.costPct, `${recipe.margin.costPct}%`, recipe.margin.costPct > 35 ? C.rose : C.iris]]
                : []),
            ].map(([label, value, colour]) => (
              <div key={label} className="p-3 rounded-lg" style={{ background: "var(--chip-bg)" }}>
                <div className="text-[10px] uppercase tracking-wide" style={{ color: C.slate }}>{label}</div>
                <div className="text-sm font-bold mt-0.5" style={{ color: colour }}>
                  {typeof value === "string" ? <span dir="ltr">{value}</span> : money(value)}
                </div>
              </div>
            ))}
          </div>

          <p className="text-[11px] mb-4" style={{ color: C.slate }}>
            {s.perPortion} · {s.methods[costing.method]}
            {costing.portions > 1 && ` · ${s.perBatch} ${costing.portions}`}
          </p>

          {/* Data quality first, because a total that is missing prices is a
              different claim from one that isn't. */}
          {!costing.complete && (
            <div className="flex gap-2.5 p-3 rounded-lg mb-4" style={{ border: `1px solid ${C.rose}` }}>
              <AlertTriangle size={15} className="shrink-0 mt-0.5" style={{ color: C.rose }} />
              <div>
                <div className="text-xs font-semibold" style={{ color: C.rose }}>{s.unpricedTitle}</div>
                <p className="text-[11px] mt-0.5" style={{ color: C.slate }}>
                  {fill(s.unpricedNote, {
                    n: costing.unpriced.length,
                    names: costing.unpriced.map((u) => u.name).join(", "),
                  })}
                </p>
              </div>
            </div>
          )}

          <div className="text-xs font-semibold mb-2" style={{ color: C.slate }}>{s.ingredients}</div>
          <div className="space-y-1.5">
            {costing.lines.map((line) => <Line key={line.ingredientId} line={line} />)}
          </div>

          {costing.packaging.length > 0 && (
            <>
              <div className="text-xs font-semibold mb-2 mt-4" style={{ color: C.slate }}>{s.packaging}</div>
              <div className="space-y-1.5">
                {costing.packaging.map((line) => <Line key={line.ingredientId} line={line} />)}
              </div>
            </>
          )}

          {!recipe.sellPrice && (
            <p className="text-[11px] mt-3" style={{ color: C.slate }}>{s.noPrice}</p>
          )}
        </>
      )}

      {simulating ? (
        <CostSimulator token={token} recipe={recipe} method={method} onClose={() => setSimulating(false)} />
      ) : (
        <div className="flex flex-wrap gap-2 mt-4">
          {costing && (
            <button onClick={() => setSimulating(true)}
              className="px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5"
              style={{ background: C.iris, color: C.onPrimary }}>
              <FlaskConical size={14} /> {s.simulate}
            </button>
          )}
          {canManage && (
            <button onClick={onEdit}
              className="px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5"
              style={{ border: `1px solid ${C.hairline}`, color: C.slate }}>
              <Pencil size={14} /> {s.save}
            </button>
          )}
          {canManage && (
            <button onClick={() => onArchive(!recipe.archived)}
              className="px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5"
              style={{ border: `1px solid ${C.hairline}`, color: C.slate }}>
              <Archive size={14} /> {recipe.archived ? s.restore : s.archive}
            </button>
          )}
          {/* Archiving keeps a dish that might come back; deleting is for the
              one that should never have existed — a duplicate, a mis-scanned
              card. Both are offered because they answer different questions,
              and offering only the first meant a wrong recipe could be hidden
              but never removed. */}
          {canManage && onDelete && (
            <button onClick={onDelete}
              className="px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5"
              style={{ border: `1px solid ${C.hairline}`, color: C.rose }}>
              <Trash2 size={14} /> {s.delete}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
