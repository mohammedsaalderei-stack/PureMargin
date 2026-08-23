import { useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useC, compact } from "../theme.jsx";
import { Money } from "../Dirham.jsx";
import { useLang } from "../i18n.jsx";
import { SectionLabel } from "../ui.jsx";
import "../glass.css";

export default function Forecast({ data }) {
  const C = useC();
  const { t } = useLang();
  const [active, setActive] = useState("base");
  const { forecast } = data;

  const scenarios = [
    { key: "conservative", label: t.forecast.cautious, color: C.slate, note: t.forecast.cautiousNote },
    { key: "base", label: t.forecast.likely, color: C.iris, note: t.forecast.likelyNote },
    { key: "optimistic", label: t.forecast.good, color: C.cyan, note: t.forecast.goodNote },
  ];
  const current = scenarios.find((s) => s.key === active);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-5 md:py-8 space-y-4 md:space-y-5">
        <div>
          <h2 className="display text-2xl md:text-3xl font-bold grad-text">{t.forecast.title}</h2>
          <p className="text-sm mt-1 max-w-2xl" style={{ color: C.slate }}>{t.forecast.lead}</p>
        </div>

        <div className="grid grid-cols-3 gap-3 md:gap-4">
          {scenarios.map((s) => {
            const on = active === s.key;
            return (
              <button key={s.key} onClick={() => setActive(s.key)}
                className="text-start glass-card p-4 md:p-5 transition-all"
                style={{ border: on ? `1.5px solid ${s.color}` : undefined, transform: on ? "translateY(-2px)" : "none" }}>
                <div className="text-xs font-semibold mb-1.5" style={{ color: s.color }}>{s.label}</div>
                <div className="display text-xl md:text-2xl font-bold leading-none"><Money value={forecast[s.key]} /></div>
                <div className="text-xs mt-2 hidden md:block" style={{ color: C.slate }}>{s.note}</div>
              </button>
            );
          })}
        </div>

        <div className="glass-card p-5 md:p-6">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="display font-bold text-base">{t.forecast.chartTitle}</h3>
            <span className="text-xs" style={{ color: C.slate }}>{current.label}</span>
          </div>
          <div className="chart" style={{ height: 240 }}>
            <ResponsiveContainer>
              <AreaChart data={forecast.series} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="gFc" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={current.color} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={current.color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: C.slate }} axisLine={false} tickLine={false}
                  interval={4} tickFormatter={(d) => `D${d}`} />
                <YAxis tick={{ fontSize: 11, fill: C.slate }} axisLine={false} tickLine={false} tickFormatter={compact} width={52} />
                <Tooltip content={({ active, payload, label }) =>
                  active && payload?.length ? (
                    <div className="rounded-xl px-3 py-2 text-xs"
                      style={{ background: "var(--panel-solid)", backdropFilter: "blur(12px)",
                        border: "1px solid rgba(139,92,246,0.2)" }}>
                      <div className="mb-1" style={{ color: C.slate }}>{t.forecast.day} {label}</div>
                      <div className="font-semibold"><Money value={payload[0].value} /></div>
                    </div>
                  ) : null
                } />
                <Area type="monotone" dataKey="optimistic" stroke="none" fill={C.lilacWash} fillOpacity={active === "optimistic" ? 0 : 0.5} />
                <Area type="monotone" dataKey="conservative" stroke="none" fill={C.surface} />
                <Area type="monotone" dataKey={active} stroke={current.color} strokeWidth={2} fill="url(#gFc)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs mt-4 leading-relaxed" style={{ color: C.slate }}>{t.forecast.note}</p>
        </div>

        <div className="glass-card p-5 md:p-6" style={{ background: C.irisWash }}>
          <h3 className="display font-bold text-base mb-3">{t.forecast.readingTitle}</h3>
          <ul className="space-y-2.5 text-sm leading-relaxed">
            {t.forecast.reading.map(([bold, rest]) => (
              <li key={bold}><strong>{bold}</strong>{rest}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
