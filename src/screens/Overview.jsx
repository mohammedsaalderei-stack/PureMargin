import { useState } from "react";
import {
  AlertTriangle, ArrowUpRight, ArrowDownRight, Star,
  MessageSquare, LineChart, UtensilsCrossed, Lightbulb, BarChart3, Plus,
} from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { useC, compact } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";
import { Money } from "../Dirham.jsx";
import { useCountUp } from "../hooks.js";
import ItemPhoto from "../ItemPhoto.jsx";
import { HudLabel, GlowDot } from "../ui.jsx";
import "../dashboard-glass.css";

/* The ring.

   Drawn rather than charted: two arcs, the track and the value, with the
   figure centred. A chart library would add a dependency and a dozen props
   to draw two circles. */
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
      className="rounded-3xl p-6 flex flex-col items-center justify-center text-center panel instrument"
      style={{
        background: `linear-gradient(150deg, ${C.iris} 0%, ${C.irisDeep} 55%, ${C.panel} 130%)`,
        minHeight: 232,
      }}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="chart">
          <defs>
            <linearGradient id="scoreArc" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={C.cyan} />
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

          {/* Graduations, every 10% — the dial reads as measured, not decorative. */}
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
                stroke="rgba(255,255,255,.28)"
                strokeWidth={i % 4 === 0 ? 1.4 : 0.7}
              />
            );
          })}

          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke="rgba(255,255,255,.14)" strokeWidth={stroke}
          />
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

      <div className="micro mt-4" style={{ color: "rgba(255,255,255,.7)" }}>
        {t.overview.scoreLabel}
      </div>
      <div className="text-xs mt-1 leading-relaxed" style={{ color: "rgba(255,255,255,.75)" }}>
        {caption}
      </div>
    </div>
  );
}

function Card({ children, className = "", style = {} }) {
  return (
    <div className={`dg-card p-6 ${className}`} style={style}>
      {children}
    </div>
  );
}

/* A 30-day shape inside a summary card. No axes — it's a gesture, not a chart. */
function Spark({ series, color }) {
  if (!series?.length) return null;
  const max = Math.max(...series);
  const min = Math.min(...series);
  const range = max - min || 1;
  const pts = series
    .map((v, i) => `${(i / (series.length - 1)) * 100},${30 - ((v - min) / range) * 28}`)
    .join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="w-full dg-glow" style={{ height: 28 }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" opacity="0.85" />
    </svg>
  );
}

function SummaryCard({ label, value, money, text, delta, note, spark, sparkColor, i }) {
  const C = useC();
  const animated = useCountUp(value);
  const shown = Math.round(animated);
  const up = (delta ?? 0) >= 0;
  return (
    <div className="dg-card dg-summary dg-stagger p-5 flex flex-col" style={{ "--i": i }}>
      <div className="text-xs font-semibold mb-2" style={{ color: C.slate }}>{label}</div>
      <div className="display text-2xl md:text-[1.7rem] font-extrabold leading-none mb-2 reading-lg truncate-safe">
        {text ? <span dir="ltr">{text}</span> : money ? <Money value={shown} /> : <span dir="ltr">{shown.toLocaleString("en-AE")}</span>}
      </div>
      <div className="flex items-center gap-2 mb-2">
        {delta !== null && delta !== undefined && (
          <span
            className="data inline-flex items-center gap-0.5 text-xs font-medium"
            style={{ color: up ? C.iris : C.rose }}
            dir="ltr"
          >
            {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            {Math.abs(delta).toFixed(1)}%
          </span>
        )}
        <span className="text-xs" style={{ color: C.slate }}>{note}</span>
      </div>
      {spark && <div className="mt-auto"><Spark series={spark} color={sparkColor || C.iris} /></div>}
    </div>
  );
}

function QuickActions({ onAsk, onOpenCosts, onGo }) {
  const C = useC();
  const { t } = useLang();
  const actions = [
    { icon: MessageSquare, label: t.ask.tab, onClick: () => onAsk?.(t.ask.suggested?.[0] || "") },
    { icon: BarChart3, label: t.watch.tab, onClick: () => onGo?.("watch") },
    { icon: LineChart, label: t.forecast.tab, onClick: () => onGo?.("forecast") },
    { icon: UtensilsCrossed, label: t.menu.tab, onClick: () => onOpenCosts?.() },
    { icon: Lightbulb, label: t.advice.tab, onClick: () => onGo?.("advice") },
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
          <a.icon size={15} style={{ color: C.cyan }} />
          {a.label}
        </button>
      ))}
    </div>
  );
}

export default function Overview({ data, onAsk, onOpenCosts, onGo }) {
  const C = useC();
  const { t } = useLang();
  const totals = data.totals;
  const margin = data.margin || {};
  const sales = useCountUp(totals.sales);
  const profit = useCountUp(totals.netProfit ?? 0);
  const [metric, setMetric] = useState("sales");

  const up = (totals.salesDelta ?? 0) >= 0;
  const star = margin.star;
  const champions = margin.champions || [];
  const leaks = margin.leakage || [];

  const leakText = (leak) => {
    const map = { cost: "leakCost", discounts: "leakDiscounts", nocost: "leakNocost" };
    const v = { ...leak.values };
    if (leak.id === "discounts") v.amount = `${data.currency} ${v.amount.toLocaleString("en-AE")}`;
    return fill(t.overview[map[leak.id]], v);
  };

  const trendData = data.daily || [];
  const trendColor = metric === "sales" ? C.iris : C.cyan;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-5 md:py-8 space-y-4 md:space-y-5">
        {/* Summary cards — key sales metrics at the top */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
          <SummaryCard
            i={0} label={t.watch.sales} value={totals.sales} money delta={totals.salesDelta}
            note={t.watch.vsPrior} spark={trendData.map((d) => d.sales)} sparkColor={C.iris}
          />
          <SummaryCard
            i={1} label={t.watch.receipts} value={totals.receipts} delta={totals.receiptsDelta}
            note={t.common.orders} spark={trendData.map((d) => d.receipts)} sparkColor={C.lilac}
          />
          <SummaryCard
            i={2} label={t.watch.avgTicket} value={totals.avgTicket} money delta={totals.avgTicketDelta}
            note={t.watch.perOrder}
          />
          <SummaryCard
            i={3} label={t.watch.peakHour} value={0} money={false}
            note={t.watch.mostOrders}
            spark={data.hours?.map((h) => h.receipts)}
          />
        </div>

        {/* Quick-action shortcuts */}
        <QuickActions onAsk={onAsk} onOpenCosts={onOpenCosts} onGo={onGo} />

        {/* Top row: turnover, what's kept, and the score */}
        <div className="grid gap-4 lg:gap-5 lg:grid-cols-[1.3fr_1fr_auto]">
          <Card className="flex flex-col justify-between hud angular dg-stagger" style={{ "--i": 4 }}>
            <HudLabel style={{ color: C.slate }}>{t.overview.totalSales}</HudLabel>
            <div className="display font-extrabold leading-none mt-6 reading-xl truncate-safe" style={{ fontSize: 40 }}>
              <Money value={Math.round(sales)} />
            </div>
            {totals.salesDelta !== null && totals.salesDelta !== undefined && (
              <div
                className="data inline-flex items-center gap-1 text-xs mt-3"
                style={{ color: up ? C.iris : C.rose }}
                dir="ltr"
              >
                {up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                {Math.abs(totals.salesDelta).toFixed(1)}% {t.watch.vsPrior}
              </div>
            )}
          </Card>

          <Card className="flex flex-col justify-between hud angular dg-stagger" style={{ "--i": 5 }}>
            <div>
              <HudLabel>{t.overview.pureMargin}</HudLabel>
              <div className="text-xs mt-1.5" style={{ color: C.slate }}>{t.overview.netProfit}</div>
            </div>
            <div
              className="display font-extrabold leading-none mt-5 neon-text reading-xl truncate-safe"
              style={{ fontSize: 42, color: C.iris }}
            >
              <Money value={Math.round(profit)} />
            </div>
            <span
              className="inline-block text-xs font-semibold px-2.5 py-1 rounded-full mt-3 self-start"
              style={{ background: C.irisWash, color: C.irisDeep }}
            >
              {fill(t.overview.marginPct, { n: totals.marginPct ?? 0 })}
            </span>
          </Card>

          <div className="lg:min-w-[232px] dg-stagger" style={{ "--i": 6 }}>
            <ScoreRing score={margin.score} />
          </div>
        </div>

        {/* Trend and the star product */}
        <div className="grid gap-4 lg:gap-5 lg:grid-cols-[1fr_1.15fr]">
          <Card>
            <div className="flex items-baseline justify-between mb-1 gap-3 flex-wrap">
              <h3 className="display font-bold text-base">{t.overview.trend}</h3>
              <div className="dg-toggle" role="group">
                <button
                  aria-pressed={metric === "sales"}
                  onClick={() => setMetric("sales")}
                >
                  {t.watch.sales}
                </button>
                <button
                  aria-pressed={metric === "receipts"}
                  onClick={() => setMetric("receipts")}
                >
                  {t.common.orders}
                </button>
              </div>
            </div>
            <p className="text-xs mb-4" style={{ color: C.slate }}>{t.overview.trendNote}</p>
            <div className="chart dg-glow" style={{ height: 190 }}>
              <ResponsiveContainer>
                <AreaChart data={trendData} margin={{ top: 6, right: 6, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="ovTrend" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={trendColor} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={trendColor} stopOpacity={0} />
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
                      background: C.surface, border: `1px solid ${C.edge}`, borderRadius: 12,
                      boxShadow: "0 8px 30px -12px rgba(0,0,0,.5)", fontSize: 12,
                    }}
                    labelStyle={{ color: C.slate }}
                    itemStyle={{ color: C.ink }}
                    formatter={(v) => metric === "sales" ? [<Money value={v} />, t.watch[metric]] : [v.toLocaleString("en-AE"), t.common.orders]}
                  />
                  <Area
                    type="monotone" dataKey={metric} stroke={trendColor} strokeWidth={2.5}
                    fill="url(#ovTrend)" animationDuration={900}
                    activeDot={{ r: 4, fill: trendColor, stroke: C.surface, strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {star ? (
            <Card style={{ background: C.irisWash, border: `1px solid ${C.irisWash}` }}>
              <div className="flex items-start justify-between mb-4">
                <span
                  className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full"
                  style={{ background: C.surface, color: C.irisDeep }}
                >
                  <Star size={11} /> {t.overview.bestPerformer}
                </span>
                <span className="display font-bold text-sm" style={{ color: C.irisDeep }}>
                  {t.overview.star}
                </span>
              </div>

              <div className="flex items-center gap-4 sm:gap-5">
                <div className="min-w-0 flex-1">
                  <div className="display font-extrabold text-2xl mb-3 truncate-safe reading-lg">{star.name}</div>
                  <div className="space-y-1.5 text-sm">
                    <div style={{ color: C.slate }}>{fill(t.overview.sold, { n: star.qty })}</div>
                    <div className="font-semibold" style={{ color: C.irisDeep }}>
                      {t.overview.netProfit}: <Money value={star.profit} />
                    </div>
                    <div style={{ color: C.slate }} dir="ltr">
                      {fill(t.overview.marginOf, { n: star.marginPct })}
                    </div>
                  </div>
                </div>
                <div className="shrink-0"><ItemPhoto name={star.name} src={star.image} size={96} /></div>
              </div>
            </Card>
          ) : (
            <Card>
              <h3 className="display font-bold text-base mb-2">{t.overview.star}</h3>
              <p className="text-sm" style={{ color: C.slate }}>{t.overview.championsNone}</p>
            </Card>
          )}
        </div>

        {/* Champions and the radar */}
        <div className="grid gap-4 lg:gap-5 lg:grid-cols-2">
          <Card>
            <h3 className="display font-bold text-base mb-1">{t.overview.champions}</h3>
            <p className="text-xs mb-4 leading-relaxed" style={{ color: C.slate }}>
              {t.overview.championsLead}
            </p>

            {champions.length === 0 ? (
              <p className="text-sm" style={{ color: C.slate }}>{t.overview.championsNone}</p>
            ) : (
              <div className="space-y-3">
                {champions.map((c) => (
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
                      style={{ background: C.irisWash, color: C.irisDeep }}
                      dir="ltr"
                    >
                      {c.marginPct}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <div className="flex items-center gap-2 mb-1">
              <GlowDot />
              <h3 className="display font-bold text-base">{t.overview.radar}</h3>
            </div>
            <p className="text-xs mb-4" style={{ color: C.slate }}>
              {fill(t.overview.coverage, { n: data.costCoverage ?? 0 })}
            </p>

            {leaks.length === 0 ? (
              <div
                className="rounded-2xl p-4 text-sm"
                style={{ background: C.irisWash, color: C.irisDeep }}
              >
                {t.overview.radarClear}
              </div>
            ) : (
              <div className="space-y-2.5">
                {leaks.map((leak) => (
                  <button
                    key={leak.id}
                    onClick={() => (leak.id === "nocost" ? onOpenCosts?.() : onAsk?.(leakText(leak)))}
                    className="w-full text-start rounded-2xl p-4 flex items-start gap-2.5"
                    style={{
                      background: leak.severity === "high" ? "rgba(196,66,110,.1)" : C.lilacWash,
                    }}
                  >
                    <AlertTriangle
                      size={15}
                      className="mt-0.5 shrink-0"
                      style={{ color: leak.severity === "high" ? C.rose : C.iris }}
                    />
                    <span className="text-sm leading-relaxed">{leakText(leak)}</span>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
