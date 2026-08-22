import { useState } from "react";
import { Loader2 } from "lucide-react";
import ItemPhoto from "../ItemPhoto.jsx";
import { useTheme } from "../theme.jsx";
import { Money } from "../Dirham.jsx";
import { useLang, fill } from "../i18n.jsx";
import { useStagger } from "../hooks.js";

/* Built from the active palette rather than declared at module scope,
   so the quadrant colours follow the theme. */
function quadrants(C, dark) {
  return [
    { key: "star", color: C.iris, wash: C.irisWash },
    { key: "workhorse", color: dark ? "#7FA0E8" : "#4C6FCF", wash: dark ? "rgba(127,160,232,.14)" : "#E9EDFA" },
    { key: "puzzle", color: C.lilac, wash: C.lilacWash },
    { key: "drag", color: C.rose, wash: dark ? "rgba(232,120,151,.14)" : "#FAEAF0" },
  ];
}

/* Scatter plot drawn by hand rather than with a chart library: the four
   quadrants and their dividing medians are the point, and a generic
   scatter would bury them. */
function Matrix({ items, medianQty, medianPerUnit, onPick, picked }) {
  const { C, dark } = useTheme();
  const { t } = useLang();
  const QUADRANTS = quadrants(C, dark);
  const W = 100, H = 100;
  const maxQty = Math.max(...items.map((i) => i.qty)) * 1.12;
  const maxUnit = Math.max(...items.map((i) => i.perUnit)) * 1.12;
  const x = (q) => (q / maxQty) * W;
  const y = (u) => H - (u / maxUnit) * H;
  const shown = useStagger(items.length, 55);

  const midX = x(medianQty);
  const midY = y(medianPerUnit);

  return (
    <div className="chart relative w-full" style={{ aspectRatio: "1.35 / 1" }}>
      <svg viewBox={`-4 -4 ${W + 8} ${H + 8}`} className="w-full h-full overflow-visible">
        {/* quadrant washes */}
        <rect x={midX} y="0" width={W - midX} height={midY} fill={C.irisWash} opacity="0.55" />
        <rect x={midX} y={midY} width={W - midX} height={H - midY} fill="#E9EDFA" opacity="0.5" />
        <rect x="0" y="0" width={midX} height={midY} fill={C.lilacWash} opacity="0.5" />
        <rect x="0" y={midY} width={midX} height={H - midY} fill="#FAEAF0" opacity="0.4" />

        {/* median lines */}
        <line x1={midX} y1="0" x2={midX} y2={H} stroke={C.hairline} strokeWidth="0.5" strokeDasharray="2 2" />
        <line x1="0" y1={midY} x2={W} y2={midY} stroke={C.hairline} strokeWidth="0.5" strokeDasharray="2 2" />

        {/* frame */}
        <rect x="0" y="0" width={W} height={H} fill="none" stroke={C.hairline} strokeWidth="0.5" />

        {items.map((item, i) => {
          const q = QUADRANTS.find((z) => z.key === item.quadrant);
          const on = picked?.name === item.name;
          const visible = i < shown;
          return (
            <g
              key={item.name}
              onClick={() => onPick(on ? null : item)}
              style={{
                cursor: "pointer",
                opacity: visible ? 1 : 0,
                transition: "opacity .35s ease",
              }}
            >
              <circle
                cx={x(item.qty)}
                cy={y(item.perUnit)}
                r={on ? 3.6 : 2.6}
                fill={q.color}
                stroke={C.surface}
                strokeWidth="0.9"
                style={{ transition: "r .2s ease" }}
              />
              {on && (
                <circle
                  cx={x(item.qty)}
                  cy={y(item.perUnit)}
                  r="6"
                  fill="none"
                  stroke={q.color}
                  strokeWidth="0.7"
                  opacity="0.5"
                />
              )}
            </g>
          );
        })}
      </svg>

      <div className="absolute -bottom-6 inset-x-0 text-center text-[11px]" style={{ color: C.slate }}>
        {t.menu.axisX} →
      </div>
      <div
        className="absolute -start-2 top-1/2 text-[11px] whitespace-nowrap"
        style={{ color: C.slate, transform: "translate(-50%, -50%) rotate(-90deg)" }}
      >
        {t.menu.axisY} →
      </div>
    </div>
  );
}

export default function Menu({ data, token, onSaved }) {
  const { C, dark } = useTheme();
  const { t } = useLang();
  const QUADRANTS = quadrants(C, dark);
  const [picked, setPicked] = useState(null);

  /* Costs the POS doesn't have. Entering them here is what turns turnover
     into net profit, so it sits above the analysis rather than buried in
     settings. */
  const missing = data.missingCosts || [];
  const [costs, setCosts] = useState({});
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState("");

  const saveCosts = async () => {
    const payload = Object.fromEntries(
      Object.entries(costs).filter(([, v]) => Number(v) > 0)
    );
    if (!Object.keys(payload).length) return;
    setSaving(true);
    try {
      const res = await fetch("/api/costs", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ costs: payload }),
      });
      if (!res.ok) throw new Error();
      setCosts({});
      setSavedNote(t.overview.costsSaved);
      onSaved?.();
    } catch {
      /* Left as-is; the inputs keep what was typed. */
    } finally {
      setSaving(false);
    }
  };

  const costPanel = missing.length > 0 && (
    <div
      className="rounded-3xl p-5 md:p-6 mb-5"
      style={{ background: C.lilacWash, border: `1px solid ${C.lilacWash}` }}
    >
      <h3 className="display font-bold text-base mb-1">{t.overview.costsTitle}</h3>
      <p className="text-xs mb-4 leading-relaxed" style={{ color: C.slate }}>
        {t.overview.costsLead}
      </p>

      <div className="space-y-2.5">
        {missing.map((item) => (
          <div
            key={item.name}
            className="flex items-center gap-3 rounded-2xl p-2.5"
            style={{ background: C.surface }}
          >
            <ItemPhoto name={item.name} src={item.image} size={38} radius={10} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate-safe">{item.name}</div>
              <div className="text-[11px]" style={{ color: C.slate }}>
                {fill(t.overview.costsSellsAt, { v: `${data.currency} ${item.unitPrice}` })}
              </div>
            </div>
            <input
              value={costs[item.name] ?? ""}
              onChange={(e) => setCosts({ ...costs, [item.name]: e.target.value })}
              inputMode="decimal"
              placeholder={t.overview.costPlaceholder}
              dir="ltr"
              className="w-24 rounded-lg px-3 py-2 text-sm outline-none text-start"
              style={{ background: C.bone, border: `1px solid ${C.hairline}`, color: C.ink }}
            />
          </div>
        ))}
      </div>

      {savedNote && <p className="text-sm mt-3" style={{ color: C.iris }}>{savedNote}</p>}

      <button
        onClick={saveCosts}
        disabled={saving || !Object.values(costs).some((v) => Number(v) > 0)}
        className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
        style={{ background: C.iris, color: C.onPrimary }}
      >
        {saving && <Loader2 size={14} className="animate-spin" />}
        {t.overview.costsSave}
      </button>
    </div>
  );
  const menu = data.menu;

  /* Quadrants need at least two priced items to have any meaning — a median
     of one number tells you nothing. Rather than an empty screen, show what
     there is: the dishes that sold, ranked. */
  if (!menu || menu.items.length < 2) {
    const sold = (data.items || []).filter((i) => i.qty > 0);
    return (
      <div className="h-full overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 md:px-8 py-5 md:py-8">
          <h2 className="display text-2xl md:text-3xl font-extrabold mb-2">{t.menu.title}</h2>
          <p className="text-sm mb-6" style={{ color: C.slate }}>{t.menu.tooEarly}</p>

          {sold.length === 0 ? (
            <p className="text-sm" style={{ color: C.slate }}>{t.menu.empty}</p>
          ) : (
            <div className="panel p-5" style={{ background: C.surface, border: `1px solid ${C.hairline}` }}>
              <div className="text-xs font-semibold mb-3" style={{ color: C.slate }}>
                {t.menu.soFar}
              </div>
              {sold.map((i) => (
                <div
                  key={i.name}
                  className="flex items-center justify-between py-3"
                  style={{ borderBottom: `1px solid ${C.hairline}` }}
                >
                  <div className="min-w-0 pe-4">
                    <div className="text-sm font-medium truncate-safe">{i.name}</div>
                    <div className="text-xs" style={{ color: C.slate }}>
                      <span dir="ltr">{Math.round(i.qty)}</span> {t.menu.ordered}
                    </div>
                  </div>
                  <span className="data text-sm shrink-0 whitespace-nowrap"><Money value={i.revenue} /></span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const counts = QUADRANTS.map((q) => ({
    ...q,
    list: menu.items.filter((i) => i.quadrant === q.key),
  }));

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-5 md:py-8 space-y-4 md:space-y-5">
        <div>
          <h2 className="display text-2xl md:text-3xl font-extrabold">{t.menu.title}</h2>
          <p className="text-sm mt-1 max-w-2xl" style={{ color: C.slate }}>{t.menu.lead}</p>
        </div>

        {costPanel}

        <div className="grid lg:grid-cols-[1.25fr_1fr] gap-5">
          <div
            className="rounded-xl p-5 md:p-6 pb-12"
            style={{ background: C.surface, border: `1px solid ${C.hairline}` }}
          >
            <Matrix
              items={menu.items}
              medianQty={menu.medianQty}
              medianPerUnit={menu.medianPerUnit}
              onPick={setPicked}
              picked={picked}
            />
          </div>

          <div className="space-y-3">
            {picked ? (
              <div
                className="rounded-xl p-5 slide-in"
                style={{
                  background: C.surface,
                  border: `1.5px solid ${QUADRANTS.find((q) => q.key === picked.quadrant).color}`,
                }}
              >
                <div
                  className="text-xs font-bold mb-2"
                  style={{ color: QUADRANTS.find((q) => q.key === picked.quadrant).color }}
                >
                  {t.menu[picked.quadrant]}
                </div>
                <div className="display text-xl font-extrabold mb-1">{picked.name}</div>
                <div className="text-xs mb-4" style={{ color: C.slate }}>{picked.category}</div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs mb-1" style={{ color: C.slate }}>{t.menu.ordered}</div>
                    <div className="display text-lg font-extrabold" dir="ltr">
                      {picked.qty.toLocaleString("en-AE")}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs mb-1" style={{ color: C.slate }}>{t.menu.perOrder}</div>
                    <div className="display text-lg font-extrabold">
                      <Money value={picked.perUnit} />
                    </div>
                  </div>
                </div>
                <p className="text-sm leading-relaxed mt-4 pt-4" style={{ color: C.slate, borderTop: `1px solid ${C.hairline}` }}>
                  {t.menu[`${picked.quadrant}Body`]}
                </p>
              </div>
            ) : (
              counts.map((q) => (
                <div
                  key={q.key}
                  className="rounded-xl p-4"
                  style={{ background: q.wash }}
                >
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="display font-bold text-sm" style={{ color: q.color }}>
                      {t.menu[q.key]}
                    </span>
                    <span className="data text-xs" style={{ color: q.color }} dir="ltr">
                      {q.list.length}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed mb-2" style={{ color: C.ink }}>
                    {t.menu[`${q.key}Body`]}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {q.list.slice(0, 4).map((i) => (
                      <button
                        key={i.name}
                        onClick={() => setPicked(i)}
                        className="text-[11px] px-2 py-1 rounded"
                        style={{ background: C.surface, color: C.slate }}
                      >
                        {i.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* The menu itself, with the owner's own photographs. The quadrant
            chart says how items relate; this says what they are. */}
        <div className="panel p-5 md:p-6">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="display font-bold text-base">{t.menu.allItems}</h3>
            <span className="micro" style={{ color: C.slate }}>{t.menu.byRevenue}</span>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            {(data.items || []).map((item) => (
              <button
                key={item.name}
                onClick={() => {
                  const inMatrix = menu.items.find((m) => m.name === item.name);
                  if (inMatrix) setPicked(inMatrix);
                }}
                className="flex items-center gap-3 rounded-2xl p-2.5 text-start"
                style={{ background: C.bone, border: `1px solid ${C.hairline}` }}
              >
                <ItemPhoto name={item.name} src={item.image} size={52} radius={14} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate-safe">{item.name}</div>
                  <div className="micro mt-1" style={{ color: C.slate }}>
                    <span dir="ltr">{Math.round(item.qty)}</span> · {t.menu.ordered}
                  </div>
                </div>
                <div className="text-end shrink-0">
                  <div className="data text-sm shrink-0 whitespace-nowrap"><Money value={item.revenue} /></div>
                  {item.hasCost && (
                    <div
                      className="data text-[11px] mt-0.5"
                      style={{ color: item.marginPct >= 40 ? C.iris : C.slate }}
                      dir="ltr"
                    >
                      {item.marginPct}%
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        <p className="text-xs leading-relaxed" style={{ color: C.slate }}>
          {t.menu.caveat}
        </p>
      </div>
    </div>
  );
}
