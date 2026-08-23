import { useC } from "../theme.jsx";
import { useLang } from "../i18n.jsx";
import { Money } from "../Dirham.jsx";

/* Each capability card carries a small working picture of the thing it
   describes, rather than only describing it. Showing beats telling on a
   page whose entire job is to explain an interface you can't see yet. */

export function AskDemo() {
  const C = useC();
  const { t } = useLang();
  return (
    <div className="rounded-xl p-4" style={{ background: C.bone, border: `1px solid ${C.hairline}` }}>
      <div className="data text-[10px] uppercase tracking-widest mb-3" style={{ color: C.slate }}>
        {t.capabilities.demoAsk}
      </div>
      <div className="flex justify-end mb-3">
        <div
          className="max-w-[85%] px-3 py-2 rounded-xl text-xs leading-relaxed"
          style={{ background: C.iris, color: C.onPrimary }}
        >
          {t.ask.suggested[0]}
        </div>
      </div>
      <div>
        <div className="data text-[10px] uppercase tracking-widest mb-1.5" style={{ color: C.iris }}>
          {t.ask.label}
        </div>
        <p className="text-xs leading-relaxed">{t.capabilities.demoAskAnswer}</p>
      </div>
    </div>
  );
}

export function WatchDemo() {
  const C = useC();
  const { t } = useLang();
  const cells = [
    { label: t.watch.sales, value: 42800, money: true, delta: "+6.8%" },
    { label: t.watch.receipts, value: 1208, money: false, delta: "+4.1%" },
    { label: t.watch.avgTicket, value: 35, money: true, delta: "+2.5%" },
  ];
  const bars = [38, 52, 44, 61, 49, 72, 66];
  return (
    <div className="rounded-xl p-4" style={{ background: C.bone, border: `1px solid ${C.hairline}` }}>
      <div className="data text-[10px] uppercase tracking-widest mb-3" style={{ color: C.slate }}>
        {t.capabilities.demoWatch}
      </div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        {cells.map((c) => (
          <div key={c.label} className="min-w-0">
            <div className="text-[10px] mb-1 truncate" style={{ color: C.slate }}>{c.label}</div>
            <div className="display font-extrabold text-sm sm:text-base leading-none">
              {c.money ? <Money value={c.value} /> : <span dir="ltr">{c.value.toLocaleString("en-AE")}</span>}
            </div>
            <div className="data text-[10px] mt-1" style={{ color: C.iris }} dir="ltr">{c.delta}</div>
          </div>
        ))}
      </div>
      <div className="chart flex items-end gap-1.5" style={{ height: 44 }}>
        {bars.map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-t"
            style={{ height: `${h}%`, background: i === bars.length - 2 ? C.lilac : C.irisWash }}
          />
        ))}
      </div>
    </div>
  );
}

export function ForecastDemo() {
  const C = useC();
  const { t } = useLang();
  const cases = [
    { label: t.forecast.cautious, value: 50700, color: C.slate },
    { label: t.forecast.likely, value: 84600, color: C.iris },
    { label: t.forecast.good, value: 118000, color: C.lilac },
  ];
  return (
    <div className="rounded-xl p-4" style={{ background: C.bone, border: `1px solid ${C.hairline}` }}>
      <div className="data text-[10px] uppercase tracking-widest mb-3" style={{ color: C.slate }}>
        {t.capabilities.demoForecast}
      </div>
      <div className="grid grid-cols-3 gap-2 mb-3">
        {cases.map((c) => (
          <div
            key={c.label}
            className="rounded-lg p-2 sm:p-2.5 min-w-0 overflow-hidden"
            style={{ border: `1px solid ${c.color === C.iris ? C.iris : C.hairline}` }}
          >
            <div className="text-[10px] mb-1 truncate" style={{ color: c.color }}>{c.label}</div>
            <div className="display font-extrabold text-xs sm:text-sm leading-none">
              <Money value={c.value} />
            </div>
          </div>
        ))}
      </div>
      {/* A widening band: the point of the section, in one shape. */}
      <svg viewBox="0 0 200 42" className="chart w-full" style={{ height: 42 }} preserveAspectRatio="none">
        <path d="M0,21 L200,4 L200,38 L0,21 Z" fill={C.irisWash} />
        <path d="M0,21 L200,21" stroke={C.iris} strokeWidth="1.5" fill="none" />
      </svg>
    </div>
  );
}

export const DEMOS = [AskDemo, WatchDemo, ForecastDemo];
