import { useState, useMemo } from "react";
import {
  ArrowUpRight, ArrowDownRight, Star, MessageSquare, LineChart,
  UtensilsCrossed, Lightbulb, BarChart3, Calendar, TrendingUp, Target,
  Zap, Activity, AlertTriangle,
} from "lucide-react";
import {
  Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip,
  Line, LineChart as ReLineChart, CartesianGrid, Bar, BarChart, Cell,
} from "recharts";
import { useC, compact } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";
import { Money } from "../Dirham.jsx";
import { useCountUp } from "../hooks.js";
import ItemPhoto from "../ItemPhoto.jsx";
import { SectionLabel, TrendIndicator } from "../ui.jsx";
import Provenance from "../Provenance.jsx";
import "../glass.css";

/* ─── Date + category filter bar ─────────────────────────── */
/* Labels come from the dictionary; they used to be hardcoded English and
   stayed English in Arabic, Hindi and Filipino. */
export const DATE_RANGES = [
  { key: "daily", label: "Today" },
  { key: "weekly", label: "This Week" },
  { key: "monthly", label: "This Month" },
];

/* The category filter that used to sit here was removed. It never worked:
   the third argument was passed to a hook that took two, so nothing was ever
   filtered, and the four labels were hardcoded English that stayed English in
   Arabic. They were also invented — the POS reports a category_id, a raw
   identifier, and only on menu items, never on the daily sales series the
   cards actually read.

   Making it real means fetching category names from the POS and aggregating
   receipt lines by category per day. That is a worthwhile feature and a
   backend change; a row of buttons that silently does nothing is not a
   smaller version of it. */

export function FilterBar({ dateRange, onDateChange }) {
  const C = useC();
  const { t } = useLang();
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-2">
        <Calendar size={14} style={{ color: C.slate }} />
        <div className="glass-filter" role="group">
          {DATE_RANGES.map((r) => (
            <button key={r.key} aria-pressed={dateRange === r.key} onClick={() => onDateChange(r.key)}>
              {t.ranges[r.key]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Derived totals by date range ───────────────────────── */
export function useDateRangeData(data, range) {
  return useMemo(() => {
    const daily = data.daily || [];
    if (!daily.length) return { totals: data.totals || {}, series: [] };
    let slice;
    if (range === "daily") slice = daily.slice(-1);
    else if (range === "weekly") slice = daily.slice(-7);
    else slice = daily;
    if (!slice.length) return { totals: data.totals || {}, series: [] };
    const sales = slice.reduce((s, d) => s + (d.sales || 0), 0);
    const receipts = slice.reduce((s, d) => s + (d.receipts || 0), 0);
    const avgTicket = receipts > 0 ? sales / receipts : 0;
    return { totals: { ...data.totals, sales, receipts, avgTicket }, series: slice };
  }, [data, range]);
}

/* ─── Summary card with trend indicator ──────────────────── */
function SummaryCard({ label, value, money, text, delta, note, spark, sparkColor, i, icon: Icon, accentColor }) {
  const C = useC();
  const animated = useCountUp(value);
  const shown = Math.round(animated);
  const accent = accentColor || C.iris;

  return (
    <div className="glass-card g-stagger p-5 flex flex-col relative overflow-hidden" style={{ "--i": i }}>
      <div className="summary-accent" style={{ background: `linear-gradient(180deg, ${accent}, transparent)` }} />
      <div className="flex items-center justify-between mb-3">
        <SectionLabel>{label}</SectionLabel>
        {Icon && (
          <div className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: `${accent}15` }}>
            <Icon size={14} style={{ color: accent }} />
          </div>
        )}
      </div>
      <div className="display text-2xl md:text-[1.7rem] font-bold leading-none mb-2 reading-lg truncate-safe">
        {text ? <span dir="ltr">{text}</span> : money ? <Money value={shown} /> : <span dir="ltr">{shown.toLocaleString("en-AE")}</span>}
      </div>
      <div className="flex items-center gap-2">
        <TrendIndicator value={delta} />
        <span className="text-xs" style={{ color: C.slate }}>{note}</span>
      </div>
      {spark && (
        <div className="mt-auto pt-3">
          <svg viewBox="0 0 100 30" preserveAspectRatio="none" style={{ height: 28, width: "100%" }}>
            <defs>
              <linearGradient id={`spark-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accent} stopOpacity={0.3} />
                <stop offset="100%" stopColor={accent} stopOpacity={0} />
              </linearGradient>
            </defs>
            {(() => {
              const max = Math.max(...spark), min = Math.min(...spark), range = max - min || 1;
              const pts = spark.map((v, idx) => `${(idx / (spark.length - 1)) * 100},${30 - ((v - min) / range) * 28}`).join(" ");
              const areaPts = `0,30 ${pts} 100,30`;
              return (
                <>
                  <polygon points={areaPts} fill={`url(#spark-${i})`} />
                  <polyline points={pts} fill="none" stroke={accent} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
                </>
              );
            })()}
          </svg>
        </div>
      )}
    </div>
  );
}

/* ─── Interactive sales trend chart ──────────────────────── */
function SalesTrendChart({ data, range }) {
  const C = useC();
  const { t } = useLang();
  const [metric, setMetric] = useState("sales");
  const [hoverIdx, setHoverIdx] = useState(null);

  const daily = data.daily || [];
  let slice;
  if (range === "daily") slice = daily.slice(-1);
  else if (range === "weekly") slice = daily.slice(-7);
  else slice = daily;

  const trendColor = metric === "sales" ? "#8B5CF6" : "#06B6D4";
  const secondaryColor = metric === "sales" ? "#06B6D4" : "#8B5CF6";

  const growth = useMemo(() => {
    if (slice.length < 2) return null;
    const first = slice[0]?.[metric] || 0;
    const last = slice[slice.length - 1]?.[metric] || 0;
    if (first === 0) return null;
    return ((last - first) / first) * 100;
  }, [slice, metric]);

  return (
    <div className="glass-card p-5 md:p-6 g-stagger" style={{ "--i": 6 }}>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={16} style={{ color: C.iris }} />
            <h3 className="display font-bold text-base">{t.overview.trendTitle}</h3>
          </div>
          <p className="text-xs" style={{ color: C.slate }}>
            {range === "daily" ? t.overview.trendToday : range === "weekly" ? t.overview.trend7 : t.overview.trend30}
            {growth !== null && (
              <span className="mx-2 data font-semibold" style={{ color: growth >= 0 ? "#10B981" : C.rose }} dir="ltr">
                {growth >= 0 ? "+" : ""}{growth.toFixed(1)}% {t.overview.growthWord}
              </span>
            )}
          </p>
        </div>
        <div className="glass-filter" role="group">
          <button aria-pressed={metric === "sales"} onClick={() => setMetric("sales")}>{t.watch.sales}</button>
          <button aria-pressed={metric === "receipts"} onClick={() => setMetric("receipts")}>{t.common.orders}</button>
        </div>
      </div>

      <div className="chart" style={{ height: 220 }}>
        <ResponsiveContainer>
          <ReLineChart data={slice} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
            onMouseMove={(e) => setHoverIdx(e?.activeTooltipIndex ?? null)} onMouseLeave={() => setHoverIdx(null)}>
            <defs>
              <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={secondaryColor} stopOpacity={0.5} />
                <stop offset="100%" stopColor={trendColor} stopOpacity={1} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(139,92,246,0.06)" strokeDasharray="4 4" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: C.slate }} axisLine={false} tickLine={false}
              interval="preserveStartEnd" minTickGap={28} />
            <YAxis tick={{ fontSize: 10, fill: C.slate }} axisLine={false} tickLine={false}
              tickFormatter={compact} width={44} />
            <Tooltip
              contentStyle={{
                background: "var(--panel-solid)", backdropFilter: "blur(12px)",
                border: "1px solid rgba(139,92,246,0.2)", borderRadius: 12,
                boxShadow: "0 8px 32px -12px rgba(139,92,246,0.3)", fontSize: 12,
              }}
              labelStyle={{ color: C.slate }} itemStyle={{ color: C.ink }}
              formatter={(v) => metric === "sales" ? [<Money value={v} />, t.watch.sales] : [v.toLocaleString("en-AE"), t.common.orders]} />
            <Line type="monotone" dataKey={metric} stroke="url(#lineGrad)" strokeWidth={2.5} dot={false}
              activeDot={{ r: 5, fill: trendColor, stroke: "rgba(15,12,29,0.9)", strokeWidth: 2 }}
              animationDuration={800} />
          </ReLineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ─── Quick actions ──────────────────────────────────────── */
function QuickActions({ onAsk, onOpenCosts, onGo }) {
  const C = useC();
  const { t } = useLang();
  const actions = [
    { icon: MessageSquare, label: t.ask.tab, onClick: () => onAsk?.(t.ask.suggested?.[0] || ""), color: "#8B5CF6" },
    { icon: BarChart3, label: t.watch.tab, onClick: () => onGo?.("watch"), color: "#06B6D4" },
    { icon: LineChart, label: t.forecast.tab, onClick: () => onGo?.("forecast"), color: "#10B981" },
    { icon: UtensilsCrossed, label: t.menu.tab, onClick: () => onOpenCosts?.(), color: "#F472B6" },
    { icon: Lightbulb, label: t.advice.tab, onClick: () => onGo?.("advice"), color: "#FBBF24" },
  ];
  return (
    <div className="flex gap-2.5 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
      {actions.map((a, i) => (
        <button key={a.label} onClick={a.onClick} className="gpill gpill-ghost shrink-0 g-stagger flex items-center gap-2 px-4 py-2.5 text-sm"
          style={{ "--i": i, color: C.ink }}>
          <a.icon size={15} style={{ color: a.color }} />{a.label}
        </button>
      ))}
    </div>
  );
}

/* ─── Food cost indicator ────────────────────────────────── */
function FoodCostIndicator({ data }) {
  const C = useC();
  const { t } = useLang();
  const cost = data.extras?.cost || 0;
  const sales = data.totals?.sales || 1;
  const pct = sales > 0 ? ((cost / sales) * 100).toFixed(1) : 0;
  const target = 30;
  const over = parseFloat(pct) > target;

  return (
    <div className="glass-card p-5 flex flex-col g-stagger" style={{ "--i": 8 }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Target size={14} style={{ color: over ? C.rose : "#10B981" }} />
          <SectionLabel>{t.overview.foodCostPct}</SectionLabel>
        </div>
        <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold"
          style={{ background: over ? "rgba(244,63,94,0.12)" : "rgba(16,185,129,0.12)",
                   color: over ? C.rose : "#10B981" }}>
          {over ? "Above Target" : "On Target"}
        </span>
      </div>
      <div className="display text-2xl font-bold" style={{ color: over ? C.rose : "#10B981" }} dir="ltr">{pct}%</div>
      <div className="text-xs mt-1" style={{ color: C.slate }}>Target ≤ {target}%</div>
      <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bar-track)" }}>
        <div className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(parseFloat(pct) / (target * 2) * 100, 100)}%`,
                   background: over ? "linear-gradient(90deg, #F43F5E, #E11D48)" : "linear-gradient(90deg, #10B981, #06B6D4)" }} />
      </div>
    </div>
  );
}

/* ─── Leakage radar ──────────────────────────────────────── */
function LeakageRadar({ data, onAsk, onOpenCosts }) {
  const C = useC();
  const { t } = useLang();
  const margin = data.margin || {};
  const leaks = margin.leakage || [];

  const leakText = (leak) => {
    const map = { cost: "leakCost", discounts: "leakDiscounts", nocost: "leakNocost" };
    const v = { ...leak.values };
    if (leak.id === "discounts") v.amount = `${data.currency} ${v.amount?.toLocaleString?.("en-AE") || 0}`;
    return fill(t.overview[map[leak.id]], v);
  };

  return (
    <div className="glass-card p-5 g-stagger" style={{ "--i": 9 }}>
      <div className="flex items-center gap-2 mb-4">
        <div className="w-2 h-2 rounded-full" style={{ background: C.rose, animation: "pulse-glow 2s ease-in-out infinite" }} />
        <h3 className="display font-bold text-base">{t.overview.radar}</h3>
      </div>
      <p className="text-xs mb-4" style={{ color: C.slate }}>{fill(t.overview.coverage, { n: data.costCoverage ?? 0 })}</p>
      {leaks.length === 0 ? (
        <div className="rounded-xl p-4 text-sm flex items-center gap-2"
          style={{ background: "rgba(16,185,129,0.08)", color: "#10B981", border: "1px solid rgba(16,185,129,0.15)" }}>
          <Zap size={14} />{t.overview.radarClear}
        </div>
      ) : (
        <div className="space-y-2.5">
          {leaks.map((leak) => (
            <button key={leak.id} onClick={() => (leak.id === "nocost" ? onOpenCosts?.() : onAsk?.(leakText(leak)))}
              className="w-full text-start rounded-xl p-4 flex items-start gap-2.5 transition-all"
              style={{ background: leak.severity === "high" ? "rgba(244,63,94,0.08)" : "rgba(139,92,246,0.06)",
                       border: `1px solid ${leak.severity === "high" ? "rgba(244,63,94,0.15)" : "rgba(139,92,246,0.1)"}` }}>
              <AlertTriangle size={15} className="mt-0.5 shrink-0"
                style={{ color: leak.severity === "high" ? C.rose : C.iris }} />
              <span className="text-sm leading-relaxed">{leakText(leak)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Main Overview ──────────────────────────────────────── */
export default function Overview({ data, dateRange, onDateRangeChange, onAsk, onOpenCosts, onGo }) {
  const C = useC();
  const { t } = useLang();

  const margin = data.margin || {};
  const { totals: filteredTotals, series } = useDateRangeData(data, dateRange);

  const sales = useCountUp(filteredTotals.sales || 0);
  const profit = useCountUp(data.totals?.netProfit ?? 0);
  const up = (filteredTotals.salesDelta ?? 0) >= 0;
  const star = margin.star;
  const champions = margin.champions || [];

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-5 md:py-8 space-y-4 md:space-y-5">

        {/* Header with filter bar */}
        <div className="flex items-center justify-between flex-wrap gap-3 g-stagger" style={{ "--i": 0 }}>
          <div>
            <h2 className="display text-2xl md:text-3xl font-bold grad-text">{t.overview.title}</h2>
            <p className="text-xs mt-1" style={{ color: C.slate }}>{t.overview.subtitle}</p>
          </div>
          <FilterBar dateRange={dateRange} onDateChange={onDateRangeChange} />
        </div>

        {/* The headline.

            Net margin was already on this screen, but four cards down and the
            same size as peak hour — so the first thing an owner saw was sales,
            which is the number that flatters and the one they already know
            from the till. What they open this app to find out is what they
            kept. It goes first, and it is the largest thing on the page. */}
        <div className="glass-card p-5 md:p-7 g-stagger relative overflow-hidden" style={{ "--i": 1 }}>
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: "radial-gradient(ellipse at 75% 40%, rgba(6,182,212,0.14) 0%, transparent 70%)" }} />
          <div className="relative flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <SectionLabel>{t.overview.pureMargin}</SectionLabel>
              <div className="text-xs mt-1" style={{ color: C.slate }}>{t.overview.netProfit}</div>
              <div className="display font-bold leading-none mt-3 truncate-safe"
                style={{ fontSize: "clamp(2.5rem, 9vw, 4.25rem)", color: C.cyan }}>
                <Money value={Math.round(profit)} />
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="inline-block text-sm font-bold px-3 py-1.5 rounded-full"
                style={{ background: "rgba(6,182,212,0.12)", color: C.cyan, border: "1px solid rgba(6,182,212,0.2)" }}>
                {fill(t.overview.marginPct, { n: data.totals?.marginPct ?? 0 })}
              </span>
              <div className="flex items-center gap-2">
                <TrendIndicator value={filteredTotals.salesDelta} />
                <span className="text-xs" style={{ color: C.slate }}>{t.watch.vsPrior}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Summary KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
          <SummaryCard i={1} label={t.watch.sales} value={filteredTotals.sales} money
            delta={filteredTotals.salesDelta} note={t.watch.vsPrior}
            spark={(series.length > 1 ? series : data.daily || []).map((d) => d.sales)}
            sparkColor="#8B5CF6" icon={Activity} accentColor="#8B5CF6" />
          <SummaryCard i={2} label={t.watch.receipts} value={filteredTotals.receipts}
            delta={filteredTotals.receiptsDelta} note={t.common.orders}
            spark={(series.length > 1 ? series : data.daily || []).map((d) => d.receipts)}
            sparkColor="#06B6D4" icon={BarChart3} accentColor="#06B6D4" />
          <SummaryCard i={3} label={t.watch.avgTicket} value={filteredTotals.avgTicket} money
            delta={filteredTotals.avgTicketDelta} note={t.watch.perOrder}
            icon={TrendingUp} accentColor="#10B981" />
          <SummaryCard i={4} label={t.watch.peakHour} value={0} money={false}
            text={data.totals?.peakHour || "—"} note={t.watch.mostOrders}
            spark={data.hours?.map((h) => h.receipts)} sparkColor="#F472B6"
            icon={Zap} accentColor="#F472B6" />
        </div>

        {/* Quick actions */}
        <QuickActions onAsk={onAsk} onOpenCosts={onOpenCosts} onGo={onGo} />

        {/* Primary financials */}
        <div className="grid gap-4 lg:gap-5 lg:grid-cols-[1.3fr_1fr_auto]">
          <div className="glass-card p-6 flex flex-col justify-between g-stagger relative overflow-hidden" style={{ "--i": 5 }}>
            <div className="absolute inset-0 pointer-events-none"
              style={{ background: "radial-gradient(ellipse at 20% 50%, rgba(139,92,246,0.12) 0%, transparent 70%)" }} />
            <SectionLabel style={{ color: C.slate }}>{t.overview.totalSales}</SectionLabel>
            <div className="display font-bold leading-none mt-6 truncate-safe" style={{ fontSize: 40 }}>
              <Money value={Math.round(sales)} />
            </div>
            {filteredTotals.salesDelta !== null && filteredTotals.salesDelta !== undefined && (
              <div className="flex items-center gap-2 mt-3">
                <TrendIndicator value={filteredTotals.salesDelta} />
                <span className="text-xs" style={{ color: C.slate }}>{t.watch.vsPrior}</span>
              </div>
            )}
          </div>

          {/* Score ring */}
          <div className="lg:min-w-[232px] g-stagger" style={{ "--i": 7 }}>
            <ScoreRing score={margin.score} />
          </div>
        </div>

        {/* Interactive sales trend chart */}
        <SalesTrendChart data={data} range={dateRange} />

        {/* Area trend + star product */}
        <div className="grid gap-4 lg:gap-5 lg:grid-cols-[1fr_1.15fr]">
          <div className="glass-card p-5 g-stagger" style={{ "--i": 10 }}>
            <div className="flex items-baseline justify-between mb-1 gap-3 flex-wrap">
              <h3 className="display font-bold text-base">{t.overview.trend}</h3>
            </div>
            <p className="text-xs mb-4" style={{ color: C.slate }}>{t.overview.trendNote}</p>
            <div className="chart" style={{ height: 160 }}>
              <ResponsiveContainer>
                <AreaChart data={series.length > 1 ? series : (data.daily || [])} margin={{ top: 6, right: 6, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="ovTrend" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8B5CF6" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#8B5CF6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: C.slate }} axisLine={false} tickLine={false}
                    interval="preserveStartEnd" minTickGap={30} />
                  <YAxis tick={{ fontSize: 10, fill: C.slate }} axisLine={false} tickLine={false}
                    tickFormatter={compact} width={46} />
                  <Tooltip contentStyle={{ background: "var(--panel-solid)", backdropFilter: "blur(12px)",
                    border: "1px solid rgba(139,92,246,0.2)", borderRadius: 12, fontSize: 12 }}
                    labelStyle={{ color: C.slate }} formatter={(v) => [<Money value={v} />, t.watch.sales]} />
                  <Area type="monotone" dataKey="sales" stroke="#8B5CF6" strokeWidth={2.5} fill="url(#ovTrend)"
                    animationDuration={900} activeDot={{ r: 4, fill: "#8B5CF6", stroke: "rgba(15,12,29,0.9)", strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {star ? (
            <div className="glass-card p-5 g-stagger" style={{ "--i": 11,
              background: "linear-gradient(135deg, rgba(139,92,246,0.10) 0%, var(--panel-grad) 100%)" }}>
              <div className="flex items-start justify-between mb-4">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full"
                  style={{ background: "rgba(167,139,250,0.12)", color: C.lilac, border: "1px solid rgba(167,139,250,0.2)" }}>
                  <Star size={11} /> {t.overview.bestPerformer}
                </span>
              </div>
              <div className="flex items-center gap-4 sm:gap-5">
                <div className="min-w-0 flex-1">
                  <div className="display font-bold text-2xl mb-3 truncate-safe reading-lg">{star.name}</div>
                  <div className="space-y-1.5 text-sm">
                    <div style={{ color: C.slate }}>{fill(t.overview.sold, { n: star.qty })}</div>
                    <div className="font-semibold" style={{ color: C.cyan }}>{t.overview.netProfit}: <Money value={star.profit} /></div>
                    <div style={{ color: C.slate }} dir="ltr">{fill(t.overview.marginOf, { n: star.marginPct })}</div>
                  </div>
                </div>
                <div className="shrink-0"><ItemPhoto name={star.name} src={star.image} size={96} /></div>
              </div>
            </div>
          ) : (
            <div className="glass-card p-5 g-stagger" style={{ "--i": 11 }}>
              <h3 className="display font-bold text-base mb-2">{t.overview.star}</h3>
              <p className="text-sm" style={{ color: C.slate }}>{t.overview.championsNone}</p>
            </div>
          )}
        </div>

        {/* Food cost + champions + leakage */}
        <div className="grid gap-4 lg:gap-5 lg:grid-cols-3">
          <FoodCostIndicator data={data} />
          <div className="glass-card p-5 g-stagger" style={{ "--i": 12 }}>
            <h3 className="display font-bold text-base mb-1">{t.overview.champions}</h3>
            <p className="text-xs mb-4 leading-relaxed" style={{ color: C.slate }}>{t.overview.championsLead}</p>
            {champions.length === 0 ? (
              <p className="text-sm" style={{ color: C.slate }}>{t.overview.championsNone}</p>
            ) : (
              <div className="space-y-3">
                {champions.map((c, idx) => (
                  <div key={c.name} className="flex items-center gap-3">
                    <ItemPhoto name={c.name} src={c.image} size={44} radius={12} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate-safe">{c.name}</div>
                      <div className="text-xs" style={{ color: C.slate }}>{fill(t.overview.sold, { n: c.qty })}</div>
                    </div>
                    <span className="data text-xs font-bold px-2 py-1 rounded-lg"
                      style={{ background: `rgba(${idx === 0 ? "167,139,250" : "6,182,212"},0.12)`,
                               color: idx === 0 ? C.lilac : C.cyan }} dir="ltr">{c.marginPct}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <LeakageRadar data={data} onAsk={onAsk} onOpenCosts={onOpenCosts} />
        </div>

        {/* What these figures are, and where they came from. Last on the page
            because it answers a question the reader only asks after the numbers. */}
        <Provenance provenance={data.provenance} />
      </div>
    </div>
  );
}

/* ─── Score ring ─────────────────────────────────────────── */
function ScoreRing({ score }) {
  const C = useC();
  const { t } = useLang();
  const value = score?.value ?? 0;
  const animated = useCountUp(value, 1100);
  const size = 132, stroke = 11, r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(1, animated / 100));

  const caption = score?.value === null ? t.overview.scoreNoCost
    : { strong: t.overview.scoreStrong, steady: t.overview.scoreSteady, watch: t.overview.scoreWatch, weak: t.overview.scoreWeak }[score?.state] || "";

  return (
    <div className="glass-card rounded-3xl p-6 flex flex-col items-center justify-center text-center"
      style={{ minHeight: 232,
        background: "linear-gradient(150deg, rgba(139,92,246,0.15) 0%, rgba(6,182,212,0.05) 60%, var(--panel-grad) 130%)" }}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="chart">
          <defs>
            <linearGradient id="scoreArc" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#8B5CF6" />
              <stop offset="100%" stopColor="#06B6D4" />
            </linearGradient>
          </defs>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bar-track)" strokeWidth={stroke} />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="url(#scoreArc)" strokeWidth={stroke}
            strokeLinecap="round" strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - filled)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="display font-bold" style={{ fontSize: 36, color: C.ink }} dir="ltr">
            {score?.value === null ? "—" : `${Math.round(animated)}%`}
          </span>
        </div>
      </div>
      <div className="micro mt-4" style={{ color: C.slate }}>{t.overview.scoreLabel}</div>
      <div className="text-xs mt-1 leading-relaxed" style={{ color: C.slate }}>{caption}</div>
    </div>
  );
}
