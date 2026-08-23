import { useLang } from "../i18n.jsx";
import { Money } from "../Dirham.jsx";

/* Each capability card carries a small working picture of the thing it
   describes. Editorial surface cards now — thin borders, monospace
   labels, no glass. */

export function AskDemo() {
  const { t } = useLang();
  return (
    <div className="ed-card p-5">
      <div className="ed-eyebrow mb-4">{t.capabilities.demoAsk}</div>
      <div className="flex justify-end mb-4">
        <div
          className="max-w-[85%] px-3.5 py-2.5 rounded-sm text-xs leading-relaxed"
          style={{ background: "var(--ed-ink)", color: "var(--ed-bg)" }}
        >
          {t.ask.suggested[0]}
        </div>
      </div>
      <div>
        <div className="ed-eyebrow mb-1.5" style={{ color: "var(--ed-accent)" }}>
          {t.ask.label}
        </div>
        <p className="text-xs leading-relaxed ed-lead">{t.capabilities.demoAskAnswer}</p>
      </div>
    </div>
  );
}

export function WatchDemo() {
  const { t } = useLang();
  const cells = [
    { label: t.watch.sales, value: 42800, money: true, delta: "+6.8%" },
    { label: t.watch.receipts, value: 1208, money: false, delta: "+4.1%" },
    { label: t.watch.avgTicket, value: 35, money: true, delta: "+2.5%" },
  ];
  const bars = [38, 52, 44, 61, 49, 72, 66];
  return (
    <div className="ed-card p-5">
      <div className="ed-eyebrow mb-4">{t.capabilities.demoWatch}</div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        {cells.map((c) => (
          <div key={c.label}>
            <div className="text-[10px] mb-1 ed-lead">{c.label}</div>
            <div className="display font-bold text-base leading-none">
              {c.money ? <Money value={c.value} /> : <span dir="ltr">{c.value.toLocaleString("en-AE")}</span>}
            </div>
            <div className="data text-[10px] mt-1" style={{ color: "var(--ed-accent)" }} dir="ltr">{c.delta}</div>
          </div>
        ))}
      </div>
      <div className="chart flex items-end gap-1.5" style={{ height: 44 }}>
        {bars.map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-t-sm"
            style={{ height: `${h}%`, background: i === bars.length - 2 ? "var(--ed-accent)" : "var(--ed-line-strong)" }}
          />
        ))}
      </div>
    </div>
  );
}

export function ForecastDemo() {
  const { t } = useLang();
  const cases = [
    { label: t.forecast.cautious, value: 50700, color: "var(--ed-muted)" },
    { label: t.forecast.likely, value: 84600, color: "var(--ed-accent)" },
    { label: t.forecast.good, value: 118000, color: "var(--ed-ink)" },
  ];
  return (
    <div className="ed-card p-5">
      <div className="ed-eyebrow mb-4">{t.capabilities.demoForecast}</div>
      <div className="grid grid-cols-3 gap-2 mb-3">
        {cases.map((c) => (
          <div
            key={c.label}
            className="rounded-sm p-2.5"
            style={{ border: `1px solid ${c.color === "var(--ed-accent)" ? "var(--ed-accent)" : "var(--ed-line)"}` }}
          >
            <div className="text-[10px] mb-1" style={{ color: c.color }}>{c.label}</div>
            <div className="display font-bold text-sm leading-none">
              <Money value={c.value} />
            </div>
          </div>
        ))}
      </div>
      <svg viewBox="0 0 200 42" className="chart w-full" style={{ height: 42 }} preserveAspectRatio="none">
        <path d="M0,21 L200,4 L200,38 L0,21 Z" fill="var(--ed-line)" />
        <path d="M0,21 L200,21" stroke="var(--ed-accent)" strokeWidth="1.5" fill="none" />
      </svg>
    </div>
  );
}

export const DEMOS = [AskDemo, WatchDemo, ForecastDemo];
