import { useState } from "react";
import { Loader2, GripVertical } from "lucide-react";
import ItemPhoto from "../ItemPhoto.jsx";
import { useTheme } from "../theme.jsx";
import { Money } from "../Dirham.jsx";
import { useLang, fill } from "../i18n.jsx";
import { useStagger } from "../hooks.js";
import { SectionLabel } from "../ui.jsx";
import "../glass.css";

/* Quadrant definitions — these are the "status columns" for the kanban board */
const QUADRANT_DEFS = [
  { key: "star", color: "#8B5CF6", wash: "rgba(139,92,246,0.08)" },
  { key: "workhorse", color: "#06B6D4", wash: "rgba(6,182,212,0.08)" },
  { key: "puzzle", color: "#F472B6", wash: "rgba(244,114,182,0.08)" },
  { key: "drag", color: "#F43F5E", wash: "rgba(244,63,94,0.08)" },
];

/* ─── Kanban board — drag items between quadrant columns ── */
function KanbanBoard({ items, onMove }) {
  const { C } = useTheme();
  const { t } = useLang();
  const [dragId, setDragId] = useState(null);
  const [dragOver, setDragOver] = useState(null);

  const columns = QUADRANT_DEFS.map((q) => ({
    ...q,
    list: items.filter((i) => i.quadrant === q.key),
  }));

  const handleDragStart = (e, item) => {
    setDragId(item.name);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e, col) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOver !== col.key) setDragOver(col.key);
  };

  const handleDrop = (e, col) => {
    e.preventDefault();
    setDragOver(null);
    if (dragId) {
      const item = items.find((i) => i.name === dragId);
      if (item && item.quadrant !== col.key) onMove(item, col.key);
    }
    setDragId(null);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
      {columns.map((col) => (
        <div
          key={col.key}
          className={`kanban-col p-3 flex flex-col ${dragOver === col.key ? "drag-over" : ""}`}
          onDragOver={(e) => handleDragOver(e, col)}
          onDragLeave={() => setDragOver(null)}
          onDrop={(e) => handleDrop(e, col)}
        >
          {/* Column header */}
          <div className="flex items-center justify-between mb-3 pb-2" style={{ borderBottom: `2px solid ${col.color}` }}>
            <span className="display font-bold text-sm" style={{ color: col.color }}>{t.menu[col.key]}</span>
            <span className="data text-xs font-bold px-2 py-0.5 rounded-full"
              style={{ background: col.wash, color: col.color }} dir="ltr">{col.list.length}</span>
          </div>
          <p className="text-[11px] leading-relaxed mb-3" style={{ color: C.slate }}>{t.menu[`${col.key}Body`]}</p>

          {/* Items */}
          <div className="space-y-2 flex-1 min-h-[40px]">
            {col.list.map((item) => (
              <div
                key={item.name}
                draggable
                onDragStart={(e) => handleDragStart(e, item)}
                onDragEnd={() => { setDragId(null); setDragOver(null); }}
                className={`kanban-item glass-card p-3 ${dragId === item.name ? "dragging" : ""}`}
                style={{ borderLeft: `3px solid ${col.color}` }}
              >
                <div className="flex items-center gap-2.5">
                  <GripVertical size={12} style={{ color: C.slate, flexShrink: 0 }} />
                  <ItemPhoto name={item.name} src={item.image} size={36} radius={10} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate-safe">{item.name}</div>
                    <div className="text-[11px] mt-0.5" style={{ color: C.slate }}>
                      <span dir="ltr">{Math.round(item.qty)}</span> {t.menu.ordered}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-2 pt-2" style={{ borderTop: `1px solid ${C.hairline}` }}>
                  <span className="data text-xs" style={{ color: C.slate }}><Money value={item.revenue} /></span>
                  {item.hasCost && (
                    <span className="data text-[11px] font-bold" style={{ color: item.marginPct >= 40 ? col.color : C.slate }} dir="ltr">
                      {item.marginPct}%
                    </span>
                  )}
                </div>
              </div>
            ))}
            {col.list.length === 0 && (
              <div className="text-center py-4 text-xs" style={{ color: C.slate }}>Drop items here</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Scatter matrix (kept for the analytical view) ──────── */
function Matrix({ items, medianQty, medianPerUnit, onPick, picked }) {
  const { C } = useTheme();
  const { t } = useLang();
  const W = 100, H = 100;
  const maxQty = Math.max(...items.map((i) => i.qty)) * 1.12;
  const maxUnit = Math.max(...items.map((i) => i.perUnit)) * 1.12;
  const x = (q) => (q / maxQty) * W;
  const y = (u) => H - (u / maxUnit) * H;
  const shown = useStagger(items.length, 55);
  const midX = x(medianQty), midY = y(medianPerUnit);

  return (
    <div className="chart relative w-full" style={{ aspectRatio: "1.35 / 1" }}>
      <svg viewBox={`-4 -4 ${W + 8} ${H + 8}`} className="w-full h-full overflow-visible">
        <rect x={midX} y="0" width={W - midX} height={midY} fill="rgba(139,92,246,0.06)" />
        <rect x={midX} y={midY} width={W - midX} height={H - midY} fill="rgba(6,182,212,0.05)" />
        <rect x="0" y="0" width={midX} height={midY} fill="rgba(244,114,182,0.05)" />
        <rect x="0" y={midY} width={midX} height={H - midY} fill="rgba(244,63,94,0.04)" />
        <line x1={midX} y1="0" x2={midX} y2={H} stroke={C.hairline} strokeWidth="0.5" strokeDasharray="2 2" />
        <line x1="0" y1={midY} x2={W} y2={midY} stroke={C.hairline} strokeWidth="0.5" strokeDasharray="2 2" />
        <rect x="0" y="0" width={W} height={H} fill="none" stroke={C.hairline} strokeWidth="0.5" />
        {items.map((item, i) => {
          const q = QUADRANT_DEFS.find((z) => z.key === item.quadrant);
          const on = picked?.name === item.name;
          const visible = i < shown;
          return (
            <g key={item.name} onClick={() => onPick(on ? null : item)}
              style={{ cursor: "pointer", opacity: visible ? 1 : 0, transition: "opacity .35s ease" }}>
              <circle cx={x(item.qty)} cy={y(item.perUnit)} r={on ? 3.6 : 2.6}
                fill={q.color} stroke={C.surface} strokeWidth="0.9" style={{ transition: "r .2s ease" }} />
              {on && <circle cx={x(item.qty)} cy={y(item.perUnit)} r="6" fill="none" stroke={q.color} strokeWidth="0.7" opacity="0.5" />}
            </g>
          );
        })}
      </svg>
      <div className="absolute -bottom-6 inset-x-0 text-center text-[11px]" style={{ color: C.slate }}>{t.menu.axisX} →</div>
      <div className="absolute -start-2 top-1/2 text-[11px] whitespace-nowrap"
        style={{ color: C.slate, transform: "translate(-50%, -50%) rotate(-90deg)" }}>{t.menu.axisY} →</div>
    </div>
  );
}

export default function Menu({ data, token, onSaved }) {
  const { C } = useTheme();
  const { t } = useLang();
  const [picked, setPicked] = useState(null);
  const [view, setView] = useState("board"); /* "board" | "matrix" */

  const missing = data.missingCosts || [];
  const [costs, setCosts] = useState({});
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState("");
  const [movedNote, setMovedNote] = useState("");

  const saveCosts = async () => {
    const payload = Object.fromEntries(Object.entries(costs).filter(([, v]) => Number(v) > 0));
    if (!Object.keys(payload).length) return;
    setSaving(true);
    try {
      const res = await fetch("/api/costs", {
        method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ costs: payload }),
      });
      if (!res.ok) throw new Error();
      setCosts({}); setSavedNote(t.overview.costsSaved); onSaved?.();
    } catch { /* */ } finally { setSaving(false); }
  };

  /* Move item between quadrants (visual reclassification) */
  const handleMove = (item, newQuadrant) => {
    // Update local state — the quadrant assignment is visual/strategic
    // (the data-driven assignment stays on the server)
    const updated = (data.menu?.items || []).map((i) =>
      i.name === item.name ? { ...i, quadrant: newQuadrant } : i
    );
    if (data.menu) data.menu.items = updated;
    setMovedNote(`${item.name} → ${t.menu[newQuadrant]}`);
    setTimeout(() => setMovedNote(""), 3000);
    setPicked(null);
  };

  const costPanel = missing.length > 0 && (
    <div className="glass-card p-5 md:p-6 mb-5">
      <h3 className="display font-bold text-base mb-1">{t.overview.costsTitle}</h3>
      <p className="text-xs mb-4 leading-relaxed" style={{ color: C.slate }}>{t.overview.costsLead}</p>
      <div className="space-y-2.5">
        {missing.map((item) => (
          <div key={item.name} className="flex items-center gap-3 rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.03)" }}>
            <ItemPhoto name={item.name} src={item.image} size={38} radius={10} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate-safe">{item.name}</div>
              <div className="text-[11px]" style={{ color: C.slate }}>{fill(t.overview.costsSellsAt, { v: `${data.currency} ${item.unitPrice}` })}</div>
            </div>
            <input value={costs[item.name] ?? ""} onChange={(e) => setCosts({ ...costs, [item.name]: e.target.value })}
              inputMode="decimal" placeholder={t.overview.costPlaceholder} dir="ltr"
              className="glass-input w-24 px-3 py-2 text-sm outline-none text-start" style={{ color: C.ink }} />
          </div>
        ))}
      </div>
      {savedNote && <p className="text-sm mt-3" style={{ color: C.iris }}>{savedNote}</p>}
      <button onClick={saveCosts} disabled={saving || !Object.values(costs).some((v) => Number(v) > 0)}
        className="mt-4 gpill gpill-primary inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold disabled:opacity-50">
        {saving && <Loader2 size={14} className="animate-spin" />}{t.overview.costsSave}
      </button>
    </div>
  );

  const menu = data.menu;

  if (!menu || menu.items.length < 2) {
    const sold = (data.items || []).filter((i) => i.qty > 0);
    return (
      <div className="h-full overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 md:px-8 py-5 md:py-8">
          <h2 className="display text-2xl md:text-3xl font-bold grad-text">{t.menu.title}</h2>
          <p className="text-sm mb-6" style={{ color: C.slate }}>{t.menu.tooEarly}</p>
          {sold.length === 0 ? (
            <p className="text-sm" style={{ color: C.slate }}>{t.menu.empty}</p>
          ) : (
            <div className="glass-card p-5">
              <SectionLabel style={{ color: C.slate }}>{t.menu.soFar}</SectionLabel>
              <div className="mt-3">
                {sold.map((i) => (
                  <div key={i.name} className="flex items-center justify-between py-3" style={{ borderBottom: `1px solid ${C.hairline}` }}>
                    <div className="min-w-0 pe-4">
                      <div className="text-sm font-medium truncate-safe">{i.name}</div>
                      <div className="text-xs" style={{ color: C.slate }}><span dir="ltr">{Math.round(i.qty)}</span> {t.menu.ordered}</div>
                    </div>
                    <span className="data text-sm shrink-0 whitespace-nowrap"><Money value={i.revenue} /></span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-5 md:py-8 space-y-4 md:space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="display text-2xl md:text-3xl font-bold grad-text">{t.menu.title}</h2>
            <p className="text-sm mt-1 max-w-2xl" style={{ color: C.slate }}>{t.menu.lead}</p>
          </div>
          {/* View toggle: Board vs Matrix */}
          <div className="glass-filter" role="group">
            <button aria-pressed={view === "board"} onClick={() => setView("board")}>Board</button>
            <button aria-pressed={view === "matrix"} onClick={() => setView("matrix")}>Matrix</button>
          </div>
        </div>

        {movedNote && (
          <div className="glass-card p-3 flex items-center gap-2 text-sm slide-in" style={{ borderLeft: "3px solid #10B981" }}>
            <span style={{ color: "#10B981" }}>✓</span> {movedNote}
          </div>
        )}

        {costPanel}

        {view === "board" ? (
          <>
            <p className="text-xs" style={{ color: C.slate }}>Drag items between columns to reclassify your strategy.</p>
            <KanbanBoard items={menu.items} onMove={handleMove} />
          </>
        ) : (
          <div className="grid lg:grid-cols-[1.25fr_1fr] gap-5">
            <div className="glass-card p-5 md:p-6 pb-12">
              <Matrix items={menu.items} medianQty={menu.medianQty} medianPerUnit={menu.medianPerUnit} onPick={setPicked} picked={picked} />
            </div>
            <div className="space-y-3">
              {picked ? (
                <div className="glass-card p-5 slide-in" style={{ border: `1.5px solid ${QUADRANT_DEFS.find((q) => q.key === picked.quadrant).color}` }}>
                  <div className="text-xs font-bold mb-2" style={{ color: QUADRANT_DEFS.find((q) => q.key === picked.quadrant).color }}>
                    {t.menu[picked.quadrant]}
                  </div>
                  <div className="display text-xl font-bold mb-1">{picked.name}</div>
                  <div className="text-xs mb-4" style={{ color: C.slate }}>{picked.category}</div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><div className="text-xs mb-1" style={{ color: C.slate }}>{t.menu.ordered}</div>
                      <div className="display text-lg font-bold" dir="ltr">{picked.qty.toLocaleString("en-AE")}</div></div>
                    <div><div className="text-xs mb-1" style={{ color: C.slate }}>{t.menu.perOrder}</div>
                      <div className="display text-lg font-bold"><Money value={picked.perUnit} /></div></div>
                  </div>
                  <p className="text-sm leading-relaxed mt-4 pt-4" style={{ color: C.slate, borderTop: `1px solid ${C.hairline}` }}>
                    {t.menu[`${picked.quadrant}Body`]}
                  </p>
                </div>
              ) : (
                QUADRANT_DEFS.map((q) => {
                  const list = menu.items.filter((i) => i.quadrant === q.key);
                  return (
                    <div key={q.key} className="glass-card p-4" style={{ borderLeft: `3px solid ${q.color}` }}>
                      <div className="flex items-baseline justify-between mb-1">
                        <span className="display font-bold text-sm" style={{ color: q.color }}>{t.menu[q.key]}</span>
                        <span className="data text-xs" style={{ color: q.color }} dir="ltr">{list.length}</span>
                      </div>
                      <p className="text-xs leading-relaxed mb-2" style={{ color: C.ink }}>{t.menu[`${q.key}Body`]}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {list.slice(0, 4).map((i) => (
                          <button key={i.name} onClick={() => setPicked(i)} className="text-[11px] px-2 py-1 rounded-lg"
                            style={{ background: "rgba(255,255,255,0.04)", color: C.slate }}>{i.name}</button>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Full menu list */}
        <div className="glass-card p-5 md:p-6">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="display font-bold text-base">{t.menu.allItems}</h3>
            <SectionLabel style={{ color: C.slate }}>{t.menu.byRevenue}</SectionLabel>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {(data.items || []).map((item) => (
              <button key={item.name}
                onClick={() => { const inMatrix = menu.items.find((m) => m.name === item.name); if (inMatrix) setPicked(inMatrix); }}
                className="flex items-center gap-3 rounded-xl p-2.5 text-start glass-card">
                <ItemPhoto name={item.name} src={item.image} size={52} radius={14} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate-safe">{item.name}</div>
                  <div className="micro mt-1" style={{ color: C.slate }}><span dir="ltr">{Math.round(item.qty)}</span> · {t.menu.ordered}</div>
                </div>
                <div className="text-end shrink-0">
                  <div className="data text-sm shrink-0 whitespace-nowrap"><Money value={item.revenue} /></div>
                  {item.hasCost && <div className="data text-[11px] mt-0.5" style={{ color: item.marginPct >= 40 ? C.iris : C.slate }} dir="ltr">{item.marginPct}%</div>}
                </div>
              </button>
            ))}
          </div>
        </div>

        <p className="text-xs leading-relaxed" style={{ color: C.slate }}>{t.menu.caveat}</p>
      </div>
    </div>
  );
}
