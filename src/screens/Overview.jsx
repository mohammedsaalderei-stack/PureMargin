import { useState, useMemo } from "react";
import {
  AlertTriangle, ArrowUpRight, ArrowDownRight, Star,
  MessageSquare, LineChart, UtensilsCrossed, Lightbulb, BarChart3,
  Calendar, TrendingUp, Target, Zap, Activity,
} from "lucide-react";
import {
  Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip,
  Line, LineChart as ReLineChart, CartesianGrid, ReferenceLine,
} from "recharts";
import { useC, compact } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";
import { Money } from "../Dirham.jsx";
import { useCountUp } from "../hooks.js";
import ItemPhoto from "../ItemPhoto.jsx";
import { HudLabel, GlowDot } from "../ui.jsx";
import "../dashboard-glass.css";

/* ─── Date filter ─────────────────────────────────────────── */
const DATE_RANGES = [
  { key: "daily",   label: "Today" },
  { key: "weekly",  label: "This Week" },
  { key: "monthly", label: "This Month" },
];

function DateFilter({ value, onChange }) {
  const C = useC();
  return (
    <div className="flex items-center gap-2">
      <Calendar size={14} style={{ color: C.slate }} />
      <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: "rgba(147,51,234,.3)" }}>
        {DATE_RANGES.map((r) => {
          const active = value === r.key;
          return (
            <button
              key={r.key}
              onClick={() => onChange(r.key)}
              className="px-3 py-1.5 text-xs font-semibold transition-all"
              style={{
                background: active
                  ? "linear-gradient(135deg, #7C3AED, #A855F7)"
                  : "rgba(147,51,234,.06)",
                color: active ? "#fff" : C.slate,
                boxShadow: active ? "0 0 14px rgba(147,51,234,.5)" : "none",
              }}
            >
              {r.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Derived totals by date range ───────────────────────── */
function useDateRangeData(data, range) {
  return useMemo(() => {
    const daily = data.daily || [];
    if (!daily.length) return { totals: data.totals || {}, series: [] };

    let slice;
    if (range === "daily") {
      slice = daily.slice(-1);
    } else if (range === "weekly") {
      slice = daily.slice(-7);
    } else {
      slice = daily;
    }

    if (!slice.length) return { totals: data.totals || {}, series: [] };

    const sales = slice.reduce((s, d) => s + (d.sales || 0), 0);
    const receipts = slice.reduce((s, d) => s + (d.receipts || 0), 0);
    const avgTicket = receipts > 0 ? sales / receipts : 0;

    return {
      totals: {
        ...data.totals,
        sales,
        receipts,
        avgTicket,
      },
      series: slice,
    };
  }, [data, range]);
}

/* ─── Score ring ──────────────────────────────────────────── */
function ScoreRing({ score }) {
  const C = useC();
  const { t } = useLang();
  const value = score?.value ?? 0;
  const animated = useCountUp(value, 1100);

  const size = 132;
  const stroke = 11;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(1, animated / 100));

  const caption = score?.value === null
    ? t.overview.scoreNoCost
    : {
        strong: t.overview.scoreStrong,
        steady: t.overview.scoreSteady,
        watch: t.overview.scoreWatch,
        weak: t.overview.scoreWeak,
      }[score?.state] || "";

  return (
    <div
      className="rounded-3xl p-6 flex flex-col items-center justify-center text-center instrument"
      style={{
        background: "linear-gradient(150deg, rgba(124,58,237,.9) 0%, rgba(76,29,149,.85) 55%, rgba(10,8,20,.95) 130%)",
        border: "1px solid rgba(167,139,250,.3)",
        boxShadow: "0 0 30px rgba(124,58,237,.25), inset 0 1px 0 rgba(255,255,255,.1)",
        minHeight: 232,
      }}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="chart">
          <defs>
            <linearGradient id="scoreArc" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#C084FC" />
              <stop offset="100%" stopColor="#FFFFFF" />
            </linearGradient>
            <filter id="scoreGlow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="4.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {Array.from({ length: 40 }).map((_, i) => {
            const angle = (i / 40) * Math.PI * 2 - Math.PI / 2;
            const inner = r - stroke / 2 - 5;
            const outer = inner - (i % 4 === 0 ? 6 : 3);
            return (
              <line
                key={i}
                x1={size / 2 + Math.cos(angle) * inner}
                y1={size / 2 + Math.sin(angle) * inner}
                x2={size / 2 + Math.cos(angle) * outer}
                y2={size / 2 + Math.sin(angle) * outer}
                stroke="rgba(255,255,255,.22)"
                strokeWidth={i % 4 === 0 ? 1.4 : 0.7}
              />
            );
          })}
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.1)" strokeWidth={stroke} />
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke="url(#scoreArc)" strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - filled)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            filter="url(#scoreGlow)"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="display font-extrabold emissive" style={{ fontSize: 36, color: "#FFFFFF" }} dir="ltr">
            {score?.value === null ? "—" : `${Math.round(animated)}%`}
          </span>
        </div>
      </div>
      <div className="micro mt-4" style={{ color: "rgba(255,255,255,.65)" }}>{t.overview.scoreLabel}</div>
      <div className="text-xs mt-1 leading-relaxed" style={{ color: "rgba(255,255,255,.7)" }}>{caption}</div>
    </div>
  );
}

/* ─── Stat card ───────────────────────────────────────────── */
function StatCard({ label, value, money, text, delta, note, spark, sparkColor, i, icon: Icon, accentColor }) {
  const C = useC();
  const animated = useCountUp(value);
  const shown = Math.round(animated);
  const up = (delta ?? 0) >= 0;
  const accent = accentColor || C.iris;

  return (
    <div
      className="dg-card dg-stagger p-5 flex flex-col relative overflow-hidden"
      style={{ "--i": i }}
    >
      {/* top accent line */}
      <div
        className="absolute top-0 left-0 right-0 h-0.5"
        style={{ background: `linear-gradient(90deg, ${accent}, transparent)` }}
      />
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-semibold" style={{ color: C.slate }}>{label}</div>
        {Icon && (
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: `${accent}22` }}
          >
            <Icon size={13} style={{ color: accent }} />
          </div>
        )}
      </div>
      <div className="display text-2xl md:text-[1.7rem] font-extrabold leading-none mb-2 reading-lg truncate-safe">
        {text ? <span dir="ltr">{text}</span> : money ? <Money value={shown} /> : <span dir="ltr">{shown.toLocaleString("en-AE")}</span>}
      </div>
      <div className="flex items-center gap-2">
        {delta !== null && delta !== undefined && (
          <span
            className="data inline-flex items-center gap-0.5 text-xs font-medium"
            style={{ color: up ? "#34D399" : C.rose }}
            dir="ltr"
          >
            {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            {Math.abs(delta).toFixed(1)}%
          </span>
        )}
        <span className="text-xs" style={{ color: C.slate }}>{note}</span>
      </div>
      {spark && (
        <div className="mt-auto pt-3">
          <svg viewBox="0 0 100 30" preserveAspectRatio="none" style={{ height: 28, width: "100%", filter: `drop-shadow(0 0 6px ${accent}66)` }}>
            {(() => {
              const max = Math.max(...spark);
              const min = Math.min(...spark);
              const range = max - min || 1;
              const pts = spark.map((v, idx) => `${(idx / (spark.length - 1)) * 100},${30 - ((v - min) / range) * 28}`).join(" ");
              return <polyline points={pts} fill="none" stroke={accent} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" opacity="0.85" />;
            })()}
          </svg>
        </div>
      )}
    </div>
  );
}

/* ─── Sales trend line chart ─────────────────────────────── */
function SalesTrendChart({ data, range }) {
  const C = useC();
  const { t } = useLang();
  const [metric, setMetric] = useState("sales");

  const daily = data.daily || [];
  let slice;
  if (range === "daily") slice = daily.slice(-1);
  else if (range === "weekly") slice = daily.slice(-7);
  else slice = daily;

  const trendColor = metric === "sales" ? "#A855F7" : "#22D3EE";
  const secondaryColor = metric === "sales" ? "#22D3EE" : "#A855F7";

  // Calculate growth %
  const growth = useMemo(() => {
    if (slice.length < 2) return null;
    const first = slice[0]?.[metric] || 0;
    const last = slice[slice.length - 1]?.[metric] || 0;
    if (first === 0) return null;
    return ((last - first) / first) * 100;
  }, [slice, metric]);

  return (
    <div className="dg-card p-5 md:p-6 dg-stagger" style={{ "--i": 6 }}>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={16} style={{ color: "#A855F7" }} />
            <h3 className="display font-bold text-base">Sales Growth Trend</h3>
          </div>
          <p className="text-xs" style={{ color: C.slate }}>
            {range === "daily" ? "Today's progression" : range === "weekly" ? "Last 7 days" : "Last 30 days"}
            {growth !== null && (
              <span
                className="ml-2 data font-semibold"
                style={{ color: growth >= 0 ? "#34D399" : C.rose }}
                dir="ltr"
              >
                {growth >= 0 ? "+" : ""}{growth.toFixed(1)}% growth
              </span>
            )}
          </p>
        </div>
        <div className="dg-toggle" role="group">
          <button aria-pressed={metric === "sales"} onClick={() => setMetric("sales")}>
            {t.watch.sales}
          </button>
          <button aria-pressed={metric === "receipts"} onClick={() => setMetric("receipts")}>
            {t.common.orders}
          </button>
        </div>
      </div>

      <div className="chart" style={{ height: 200 }}>
        <ResponsiveContainer>
          <ReLineChart data={slice} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <defs>
              <linearGradient id="lineGradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={secondaryColor} stopOpacity={0.4} />
                <stop offset="100%" stopColor={trendColor} stopOpacity={1} />
              </linearGradient>
              <filter id="lineGlow">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            <CartesianGrid stroke="rgba(147,51,234,.08)" strokeDasharray="4 4" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: C.slate }}
              axisLine={false} tickLine={false}
              interval="preserveStartEnd" minTickGap={28}
            />
            <YAxis
              tick={{ fontSize: 10, fill: C.slate }}
              axisLine={false} tickLine={false}
              tickFormatter={compact} width={44}
            />
            <Tooltip
              contentStyle={{
                background: "rgba(13,12,24,.95)",
                border: "1px solid rgba(147,51,234,.4)",
                borderRadius: 12,
                boxShadow: "0 8px 30px -12px rgba(147,51,234,.5)",
                fontSize: 12,
              }}
              labelStyle={{ color: C.slate }}
              itemStyle={{ color: "#fff" }}
              formatter={(v) =>
                metric === "sales"
                  ? [<Money value={v} />, t.watch.sales]
                  : [v.toLocaleString("en-AE"), t.common.orders]
              }
            />
            <Line
              type="monotone"
              dataKey={metric}
              stroke="url(#lineGradient)"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 5, fill: trendColor, stroke: "rgba(13,12,24,.9)", strokeWidth: 2 }}
              animationDuration={800}
              filter="url(#lineGlow)"
            />
          </ReLineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ─── Quick actions ───────────────────────────────────────── */
function QuickActions({ onAsk, onOpenCosts, onGo }) {
  const C = useC();
  const { t } = useLang();
  const actions = [
    { icon: MessageSquare, label: t.ask.tab, onClick: () => onAsk?.(t.ask.suggested?.[0] || ""), color: "#A855F7" },
    { icon: BarChart3, label: t.watch.tab, onClick: () => onGo?.("watch"), color: "#22D3EE" },
    { icon: LineChart, label: t.forecast.tab, onClick: () => onGo?.("forecast"), color: "#34D399" },
    { icon: UtensilsCrossed, label: t.menu.tab, onClick: () => onOpenCosts?.(), color: "#F472B6" },
    { icon: Lightbulb, label: t.advice.tab, onClick: () => onGo?.("advice"), color: "#FBBF24" },
  ];
  return (
    <div className="flex gap-2.5 overflow-x-auto dg-snap pb-1 -mx-1 px-1">
      {actions.map((a, i) => (
        <button
          key={a.label}
          onClick={a.onClick}
          className="dg-quick dg-stagger shrink-0"
          style={{ "--i": i, color: C.ink }}
        >
          <a.icon size={15} style={{ color: a.color }} />
          {a.label}
        </button>
      ))}
    </div>
  );
}

/* ─── Food cost indicator (from PDF section 8) ────────────── */
function FoodCostIndicator({ data }) {
  const C = useC();
  const cost = data.extras?.cost || 0;
  const sales = data.totals?.sales || 1;
  const pct = sales > 0 ? ((cost / sales) * 100).toFixed(1) : 0;
  const target = 30; // typical target food cost %
  const over = parseFloat(pct) > target;

  return (
    <div
      className="dg-card p-5 flex flex-col dg-stagger"
      style={{ "--i": 8, borderColor: over ? "rgba(251,94,126,.3)" : "rgba(52,211,153,.2)" }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Target size={14} style={{ color: over ? "#FB5E7E" : "#34D399" }} />
          <span className="text-xs font-semibold" style={{ color: C.slate }}>Food Cost %</span>
        </div>
        <span
          className="text-xs px-2 py-0.5 rounded-full font-semibold"
          style={{
            background: over ? "rgba(251,94,126,.15)" : "rgba(52,211,153,.15)",
            color: over ? "#FB5E7E" : "#34D399",
          }}
        >
          {over ? "Above Target" : "On Target"}
        </span>
      </div>
      <div className="display text-2xl font-extrabold" style={{ color: over ? "#FB5E7E" : "#34D399" }} dir="ltr">
        {pct}%
      </div>
      <div className="text-xs mt-1" style={{ color: C.slate }}>
        Target ≤ {target}%
      </div>
      <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,.08)" }}>
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${Math.min(parseFloat(pct) / (target * 2) * 100, 100)}%`,
            background: over
              ? "linear-gradient(90deg, #FB5E7E, #F43F5E)"
              : "linear-gradient(90deg, #34D399, #10B981)",
          }}
        />
      </div>
    </div>
  );
}

/* ─── Leakage radar ───────────────────────────────────────── */
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
    <div className="dg-card p-5 dg-stagger" style={{ "--i": 9 }}>
      <div className="flex items-center gap-2 mb-4">
        <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: "#FB5E7E" }} />
        <h3 className="display font-bold text-base">{t.overview.radar}</h3>
      </div>
      <p className="text-xs mb-4" style={{ color: C.slate }}>
        {fill(t.overview.coverage, { n: data.costCoverage ?? 0 })}
      </p>

      {leaks.length === 0 ? (
        <div
          className="rounded-2xl p-4 text-sm flex items-center gap-2"
          style={{ background: "rgba(52,211,153,.1)", color: "#34D399", border: "1px solid rgba(52,211,153,.2)" }}
        >
          <Zap size={14} />
          {t.overview.radarClear}
        </div>
      ) : (
        <div className="space-y-2.5">
          {leaks.map((leak) => (
            <button
              key={leak.id}
              onClick={() => (leak.id === "nocost" ? onOpenCosts?.() : onAsk?.(leakText(leak)))}
              className="w-full text-start rounded-2xl p-4 flex items-start gap-2.5 transition-all"
              style={{
                background: leak.severity === "high"
                  ? "rgba(251,94,126,.1)"
                  : "rgba(147,51,234,.08)",
                border: `1px solid ${leak.severity === "high" ? "rgba(251,94,126,.2)" : "rgba(147,51,234,.15)"}`,
              }}
            >
              <AlertTriangle
                size={15}
                className="mt-0.5 shrink-0"
                style={{ color: leak.severity === "high" ? "#FB5E7E" : "#A855F7" }}
              />
              <span className="text-sm leading-relaxed">{leakText(leak)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Main Overview ───────────────────────────────────────── */
export default function Overview({ data, onAsk, onOpenCosts, onGo }) {
  const C = useC();
  const { t } = useLang();
  const [dateRange, setDateRange] = useState("monthly");

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

        {/* Header with date filter */}
        <div className="flex items-center justify-between flex-wrap gap-3 dg-stagger" style={{ "--i": 0 }}>
          <div>
            <h2 className="display text-2xl md:text-3xl font-extrabold">{t.overview.title}</h2>
            <p className="text-xs mt-1" style={{ color: C.slate }}>Profitability & Operations Overview</p>
          </div>
          <DateFilter value={dateRange} onChange={setDateRange} />
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
          <StatCard
            i={1} label={t.watch.sales} value={filteredTotals.sales} money
            delta={filteredTotals.salesDelta}
            note={t.watch.vsPrior}
            spark={(series.length > 1 ? series : data.daily || []).map((d) => d.sales)}
            sparkColor="#A855F7"
            icon={Activity} accentColor="#A855F7"
          />
          <StatCard
            i={2} label={t.watch.receipts} value={filteredTotals.receipts}
            delta={filteredTotals.receiptsDelta}
            note={t.common.orders}
            spark={(series.length > 1 ? series : data.daily || []).map((d) => d.receipts)}
            sparkColor="#22D3EE"
            icon={BarChart3} accentColor="#22D3EE"
          />
          <StatCard
            i={3} label={t.watch.avgTicket} value={filteredTotals.avgTicket} money
            delta={filteredTotals.avgTicketDelta}
            note={t.watch.perOrder}
            icon={TrendingUp} accentColor="#34D399"
          />
          <StatCard
            i={4} label={t.watch.peakHour} value={0} money={false}
            text={data.totals?.peakHour || "—"}
            note={t.watch.mostOrders}
            spark={data.hours?.map((h) => h.receipts)}
            sparkColor="#F472B6"
            icon={Zap} accentColor="#F472B6"
          />
        </div>

        {/* Quick actions */}
        <QuickActions onAsk={onAsk} onOpenCosts={onOpenCosts} onGo={onGo} />

        {/* Primary financials */}
        <div className="grid gap-4 lg:gap-5 lg:grid-cols-[1.3fr_1fr_auto]">
          <div
            className="dg-card p-6 flex flex-col justify-between hud angular dg-stagger relative overflow-hidden"
            style={{ "--i": 5 }}
          >
            {/* Background glow */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: "radial-gradient(ellipse at 20% 50%, rgba(124,58,237,.18) 0%, transparent 70%)",
              }}
            />
            <HudLabel style={{ color: C.slate }}>{t.overview.totalSales}</HudLabel>
            <div className="display font-extrabold leading-none mt-6 truncate-safe" style={{ fontSize: 40 }}>
              <Money value={Math.round(sales)} />
            </div>
            {filteredTotals.salesDelta !== null && filteredTotals.salesDelta !== undefined && (
              <div
                className="data inline-flex items-center gap-1 text-xs mt-3"
                style={{ color: up ? "#34D399" : C.rose }}
                dir="ltr"
              >
                {up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                {Math.abs(filteredTotals.salesDelta).toFixed(1)}% {t.watch.vsPrior}
              </div>
            )}
          </div>

          <div
            className="dg-card p-6 flex flex-col justify-between hud angular dg-stagger relative overflow-hidden"
            style={{ "--i": 6 }}
          >
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: "radial-gradient(ellipse at 80% 50%, rgba(34,211,238,.12) 0%, transparent 70%)",
              }}
            />
            <div>
              <HudLabel>{t.overview.pureMargin}</HudLabel>
              <div className="text-xs mt-1.5" style={{ color: C.slate }}>{t.overview.netProfit}</div>
            </div>
            <div
              className="display font-extrabold leading-none mt-5 truncate-safe"
              style={{ fontSize: 40, color: "#22D3EE", textShadow: "0 0 20px rgba(34,211,238,.5)" }}
            >
              <Money value={Math.round(profit)} />
            </div>
            <span
              className="inline-block text-xs font-semibold px-2.5 py-1 rounded-full mt-3 self-start"
              style={{ background: "rgba(34,211,238,.15)", color: "#22D3EE", border: "1px solid rgba(34,211,238,.3)" }}
            >
              {fill(t.overview.marginPct, { n: data.totals?.marginPct ?? 0 })}
            </span>
          </div>

          <div className="lg:min-w-[232px] dg-stagger" style={{ "--i": 7 }}>
            <ScoreRing score={margin.score} />
          </div>
        </div>

        {/* Sales trend line chart */}
        <SalesTrendChart data={data} range={dateRange} />

        {/* Area trend + star product */}
        <div className="grid gap-4 lg:gap-5 lg:grid-cols-[1fr_1.15fr]">
          <div className="dg-card p-5 dg-stagger" style={{ "--i": 10 }}>
            <div className="flex items-baseline justify-between mb-1 gap-3 flex-wrap">
              <h3 className="display font-bold text-base">{t.overview.trend}</h3>
            </div>
            <p className="text-xs mb-4" style={{ color: C.slate }}>{t.overview.trendNote}</p>
            <div className="chart" style={{ height: 160 }}>
              <ResponsiveContainer>
                <AreaChart
                  data={series.length > 1 ? series : (data.daily || [])}
                  margin={{ top: 6, right: 6, left: -20, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="ovTrend2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#A855F7" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#A855F7" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="label" tick={{ fontSize: 10, fill: C.slate }}
                    axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={30}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: C.slate }} axisLine={false}
                    tickLine={false} tickFormatter={compact} width={46}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "rgba(13,12,24,.95)",
                      border: "1px solid rgba(147,51,234,.4)",
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                    labelStyle={{ color: C.slate }}
                    formatter={(v) => [<Money value={v} />, t.watch.sales]}
                  />
                  <Area
                    type="monotone" dataKey="sales" stroke="#A855F7" strokeWidth={2.5}
                    fill="url(#ovTrend2)" animationDuration={900}
                    activeDot={{ r: 4, fill: "#A855F7", stroke: "rgba(13,12,24,.9)", strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {star ? (
            <div
              className="dg-card p-5 dg-stagger"
              style={{
                "--i": 11,
                background: "linear-gradient(135deg, rgba(124,58,237,.15) 0%, rgba(13,12,24,.8) 100%)",
                border: "1px solid rgba(167,139,250,.25)",
              }}
            >
              <div className="flex items-start justify-between mb-4">
                <span
                  className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full"
                  style={{ background: "rgba(167,139,250,.15)", color: "#C084FC", border: "1px solid rgba(167,139,250,.3)" }}
                >
                  <Star size={11} /> {t.overview.bestPerformer}
                </span>
              </div>
              <div className="flex items-center gap-4 sm:gap-5">
                <div className="min-w-0 flex-1">
                  <div className="display font-extrabold text-2xl mb-3 truncate-safe reading-lg">{star.name}</div>
                  <div className="space-y-1.5 text-sm">
                    <div style={{ color: C.slate }}>{fill(t.overview.sold, { n: star.qty })}</div>
                    <div className="font-semibold" style={{ color: "#22D3EE" }}>
                      {t.overview.netProfit}: <Money value={star.profit} />
                    </div>
                    <div style={{ color: C.slate }} dir="ltr">
                      {fill(t.overview.marginOf, { n: star.marginPct })}
                    </div>
                  </div>
                </div>
                <div className="shrink-0"><ItemPhoto name={star.name} src={star.image} size={96} /></div>
              </div>
            </div>
          ) : (
            <div className="dg-card p-5 dg-stagger" style={{ "--i": 11 }}>
              <h3 className="display font-bold text-base mb-2">{t.overview.star}</h3>
              <p className="text-sm" style={{ color: C.slate }}>{t.overview.championsNone}</p>
            </div>
          )}
        </div>

        {/* Food cost + leakage + champions */}
        <div className="grid gap-4 lg:gap-5 lg:grid-cols-3">
          <FoodCostIndicator data={data} />

          <div className="dg-card p-5 dg-stagger" style={{ "--i": 12 }}>
            <h3 className="display font-bold text-base mb-1">{t.overview.champions}</h3>
            <p className="text-xs mb-4 leading-relaxed" style={{ color: C.slate }}>
              {t.overview.championsLead}
            </p>
            {champions.length === 0 ? (
              <p className="text-sm" style={{ color: C.slate }}>{t.overview.championsNone}</p>
            ) : (
              <div className="space-y-3">
                {champions.map((c, idx) => (
                  <div key={c.name} className="flex items-center gap-3">
                    <ItemPhoto name={c.name} src={c.image} size={44} radius={12} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate-safe">{c.name}</div>
                      <div className="text-xs" style={{ color: C.slate }}>
                        {fill(t.overview.sold, { n: c.qty })}
                      </div>
                    </div>
                    <span
                      className="data text-xs font-bold px-2 py-1 rounded-lg"
                      style={{
                        background: `rgba(${idx === 0 ? "167,139,250" : "34,211,238"},.15)`,
                        color: idx === 0 ? "#C084FC" : "#22D3EE",
                      }}
                      dir="ltr"
                    >
                      {c.marginPct}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <LeakageRadar data={data} onAsk={onAsk} onOpenCosts={onOpenCosts} />
        </div>
      </div>
    </div>
  );
}
