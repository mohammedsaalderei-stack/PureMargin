import { ArrowDownRight, ArrowUpRight, Sparkles } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { useC, compact } from "../theme.jsx";
import { Money } from "../Dirham.jsx";
import { useLang, fill } from "../i18n.jsx";
import { useCountUp, useStagger } from "../hooks.js";
import "../dashboard-glass.css";

function Delta({ value }) {
  const C = useC();
  if (value === null || value === undefined) return null;
  const up = value >= 0;
  return (
    <span
      className="data inline-flex items-center gap-0.5 text-xs font-medium"
      style={{ color: up ? C.iris : C.rose }}
      dir="ltr"
    >
      {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

/* A 30-day shape inside the metric card. No axes — it's a gesture, not a chart. */
function Spark({ series, color }) {
  if (!series?.length) return null;
  const max = Math.max(...series);
  const min = Math.min(...series);
  const range = max - min || 1;
  const pts = series
    .map((v, i) => `${(i / (series.length - 1)) * 100},${28 - ((v - min) / range) * 26}`)
    .join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="w-full dg-glow" style={{ height: 26 }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" opacity="0.8" />
    </svg>
  );
}

function Metric({ label, value, money, delta, note, spark, sparkColor, i }) {
  const C = useC();
  const animated = useCountUp(value);
  const shown = Math.round(animated);
  return (
    <div className="dg-card dg-stagger p-5 flex flex-col" style={{ "--i": i }}>
      <div className="text-xs font-semibold mb-2" style={{ color: C.slate }}>{label}</div>
      <div className="display text-2xl md:text-3xl font-extrabold leading-none mb-2 reading-lg">
        {money ? <Money value={shown} /> : <span dir="ltr">{shown.toLocaleString("en-AE")}</span>}
      </div>
      <div className="flex items-center gap-2 mb-2">
        <Delta value={delta} />
        <span className="text-xs" style={{ color: C.slate }}>{note}</span>
      </div>
      {spark && <div className="mt-auto"><Spark series={spark} color={sparkColor || C.iris} /></div>}
    </div>
  );
}

function TextMetric({ label, value, note, i }) {
  const C = useC();
  return (
    <div className="dg-card dg-stagger p-5 flex flex-col" style={{ "--i": i }}>
      <div className="text-xs font-semibold mb-2" style={{ color: C.slate }}>{label}</div>
      <div className="display text-2xl md:text-3xl font-extrabold leading-none mb-2 reading-lg" dir="ltr">{value}</div>
      <span className="text-xs" style={{ color: C.slate }}>{note}</span>
    </div>
  );
}

function Panel({ title, note, children, i }) {
  return (
    <div className="dg-card dg-stagger p-5 md:p-6" style={{ "--i": i }}>
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="display font-bold text-base">{title}</h3>
        {note && <span className="text-xs" style={{ color: C.slate }}>{note}</span>}
      </div>
      {children}
    </div>
  );
}

/* Custom tooltip so amounts carry the Dirham mark rather than a text code. */
function ChartTip({ active, payload, label, money, name }) {
  const C = useC();
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-lg px-3 py-2 text-xs"
      style={{ background: C.surface, border: `1px solid ${C.edge}`, boxShadow: "0 8px 30px -12px rgba(0,0,0,.4)" }}
    >
      <div className="mb-1 truncate-safe max-w-[180px]" style={{ color: C.slate }}>{label}</div>
      <div className="font-semibold flex items-center gap-1.5">
        {money ? <Money value={payload[0].value} /> : <span dir="ltr">{payload[0].value.toLocaleString("en-AE")}</span>}
        {name && <span style={{ color: C.slate }}>{name}</span>}
      </div>
    </div>
  );
}

/* Plain-language observations, generated from the numbers rather than by a model
   — same input always gives the same reading. */
function Insights({ items }) {
  const C = useC();
  const { t } = useLang();
  const shown = useStagger(items.length, 110);
  if (!items.length) return null;

  const line = (o) => {
    const v = { ...o.values };
    if (o.id === "trend") v.dir = t.insights[o.tone === "good" ? "up" : "down"];
    if (o.id === "weekend") v.dir = t.insights[v.up ? "above" : "below"];
    return fill(t.insights[o.id], v);
  };

  return (
    <div className="panel p-5" style={{ background: C.panel }}>
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={15} style={{ color: C.lilac }} />
        <h3 className="display font-bold text-sm">{t.insights.title}</h3>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2.5">
        {items.map((o, i) => (
          <div
            key={o.id}
            className="flex items-start gap-2.5 text-sm"
            style={{
              color: C.panelMuted,
              opacity: i < shown ? 1 : 0,
              transform: i < shown ? "none" : "translateY(4px)",
              transition: "opacity .4s ease, transform .4s ease",
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
              style={{ background: o.tone === "good" ? C.iris : o.tone === "warn" ? C.lilac : "rgba(255,255,255,.35)" }}
            />
            <span>{line(o)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Watch({ data }) {
  const C = useC();
  const { t } = useLang();
  const { totals, daily, stores, items, hours, observations } = data;
  const peak = Math.max(...hours.map((h) => h.receipts), 0);
  const topStore = Math.max(...stores.map((s) => s.sales), 1);
  const topItems = items.slice(0, 8);
  const maxRev = Math.max(...topItems.map((it) => it.revenue), 1);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-5 md:py-8 space-y-4 md:space-y-5">
        <div className="dg-stagger" style={{ "--i": 0 }}>
          <h2 className="display text-2xl md:text-3xl font-extrabold">{t.watch.title}</h2>
          <p className="text-sm mt-1" style={{ color: C.slate }}>
            {data.limitedHistory ? t.watch.limitedHistory : t.watch.lead}
          </p>
        </div>

        {observations?.length > 0 && <Insights items={observations} />}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
          <Metric
            i={1} label={t.watch.sales} value={totals.sales} money delta={totals.salesDelta}
            note={t.watch.vsPrior} spark={daily.map((d) => d.sales)}
          />
          <Metric
            i={2} label={t.watch.receipts} value={totals.receipts} delta={totals.receiptsDelta}
            note={t.common.orders} spark={daily.map((d) => d.receipts)} sparkColor={C.lilac}
          />
          <Metric
            i={3} label={t.watch.avgTicket} value={totals.avgTicket} money delta={totals.avgTicketDelta}
            note={t.watch.perOrder}
          />
          <TextMetric i={4} label={t.watch.peakHour} value={totals.peakHour} note={t.watch.mostOrders} />
        </div>

        <Panel i={5} title={t.watch.byDay} note={t.watch.last30}>
          <div className="chart dg-glow" style={{ height: 220 }}>
            <ResponsiveContainer>
              <AreaChart data={daily} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="gSales" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.iris} stopOpacity={0.26} />
                    <stop offset="100%" stopColor={C.iris} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: C.slate }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={28} />
                <YAxis tick={{ fontSize: 11, fill: C.slate }} axisLine={false} tickLine={false} tickFormatter={compact} width={52} />
                <Tooltip content={<ChartTip money name={t.watch.sales} />} />
                <Area
                  type="monotone" dataKey="sales" stroke={C.iris} strokeWidth={2.5} fill="url(#gSales)"
                  animationDuration={900}
                  activeDot={{ r: 4, fill: C.iris, stroke: C.surface, strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <div className="grid gap-4 lg:gap-5 lg:grid-cols-2">
          <Panel i={6} title={t.watch.branches} note={t.watch.bySales}>
            <div className="space-y-4">
              {stores.map((s, i) => (
                <div key={s.id}>
                  <div className="flex items-baseline justify-between mb-1.5">
                    <span className="text-sm font-medium truncate pe-3">{s.name}</span>
                    <span className="data text-sm shrink-0"><Money value={s.sales} /></span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: C.bone }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(s.sales / topStore) * 100}%`,
                        background: `linear-gradient(90deg, ${C.iris}, ${C.cyan})`,
                        transition: "width 1s cubic-bezier(.2,.7,.3,1)",
                        transitionDelay: `${i * 120}ms`,
                      }}
                    />
                  </div>
                  <div className="text-xs mt-1" style={{ color: C.slate }}>
                    <span dir="ltr">{s.receipts.toLocaleString("en-AE")}</span> {t.common.orders}
                  </div>
                </div>
              ))}
              {stores.length === 0 && <p className="text-sm" style={{ color: C.slate }}>{t.watch.noBranches}</p>}
            </div>
          </Panel>

          <Panel i={7} title={t.watch.byHour} note={t.watch.peakHighlighted}>
            <div className="chart dg-glow" style={{ height: 180 }}>
              <ResponsiveContainer>
                <BarChart data={hours} margin={{ top: 8, right: 4, left: -24, bottom: 0 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: C.slate }} axisLine={false} tickLine={false} interval={1} />
                  <YAxis tick={{ fontSize: 11, fill: C.slate }} axisLine={false} tickLine={false} width={44} />
                  <Tooltip content={<ChartTip name={t.watch.receipts} />} cursor={{ fill: C.bone }} />
                  <Bar dataKey="receipts" radius={[4, 4, 0, 0]} animationDuration={800}>
                    {hours.map((h, i) => (
                      <Cell key={i} fill={h.receipts === peak ? C.lilac : C.irisWash} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </div>

        {data.payments?.length > 0 && (
          <div className="grid gap-4 lg:gap-5 lg:grid-cols-2">
            <Panel i={8} title={t.watch.payments} note={t.watch.paymentsNote}>
              <div className="flex items-center gap-5">
                <div className="chart shrink-0 dg-glow" style={{ width: 130, height: 130 }}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={data.payments}
                        dataKey="amount"
                        innerRadius={40}
                        outerRadius={62}
                        paddingAngle={2}
                        stroke="none"
                      >
                        {data.payments.map((_, i) => (
                          <Cell key={i} fill={[C.iris, C.lilac, "#5FBFA0", "#7FA0E8"][i % 4]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 min-w-0 space-y-2.5">
                  {data.payments.map((pm, i) => (
                    <div key={pm.method} className="flex items-center gap-2.5">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: [C.iris, C.lilac, "#5FBFA0", "#7FA0E8"][i % 4] }}
                      />
                      <span className="text-sm flex-1 truncate">{pm.method}</span>
                      <span className="data text-sm shrink-0 whitespace-nowrap"><Money value={pm.amount} /></span>
                      <span className="data text-xs w-12 text-end" style={{ color: C.slate }} dir="ltr">
                        {pm.share}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </Panel>

            <Panel i={9} title={t.watch.extras} note="">
              {[
                ["discounts", data.extras?.discounts ?? 0],
                ["refunds", data.extras?.refunds ?? 0],
                ["cost", data.extras?.cost ?? 0],
              ].map(([key, value]) => (
                <div
                  key={key}
                  className="flex items-center justify-between py-3"
                  style={{ borderBottom: `1px solid ${C.hairline}` }}
                >
                  <span className="text-sm" style={{ color: C.slate }}>{t.watch[key]}</span>
                  <span className="display font-extrabold text-base"><Money value={value} /></span>
                </div>
              ))}
              <p className="text-[11px] mt-3 leading-relaxed" style={{ color: C.slate }}>
                {t.watch.extrasNote}
              </p>
            </Panel>
          </div>
        )}

        {/* Top items — an interactive horizontal bar chart, replacing the table. */}
        <Panel i={10} title={t.watch.topItems} note={t.watch.byRevenue}>
          {topItems.length === 0 ? (
            <p className="text-sm py-4" style={{ color: C.slate }}>{t.watch.noItems}</p>
          ) : (
            <div className="chart dg-glow" style={{ height: topItems.length * 38 + 8 }}>
              <ResponsiveContainer>
                <BarChart
                  data={topItems}
                  layout="vertical"
                  margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
                  barCategoryGap={10}
                >
                  <defs>
                    <linearGradient id="gItems" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor={C.iris} />
                      <stop offset="100%" stopColor={C.cyan} />
                    </linearGradient>
                  </defs>
                  <XAxis type="number" hide domain={[0, maxRev * 1.1]} />
                  <YAxis
                    type="category" dataKey="name" width={120}
                    tick={{ fontSize: 11, fill: C.ink }}
                    axisLine={false} tickLine={false}
                  />
                  <Tooltip
                    content={<ChartTip money name={t.watch.sales} />}
                    cursor={{ fill: C.bone, opacity: 0.4 }}
                  />
                  <Bar
                    dataKey="revenue" radius={[5, 5, 5, 5]} fill="url(#gItems)"
                    animationDuration={800}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {topItems.length > 0 && (
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3 pt-3" style={{ borderTop: `1px solid ${C.hairline}` }}>
              {topItems.map((it) => (
                <span key={it.name} className="data text-xs" style={{ color: C.slate }} dir="ltr">
                  {it.name} · {it.share}%
                </span>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
