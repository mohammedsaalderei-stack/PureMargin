/* What each channel actually brought in.

   Read from the figures each order was given when it was rung up — its
   channel, the fees in force that day, what it made — so this is a record,
   not a recalculation: a commission changed last week moves nothing here
   from the week before. */

import { fill } from "../i18n.jsx";
import { fmt, pct } from "./shared.jsx";

export default function ChannelReport({ data, T, C, days, onDays }) {
  const R = T.report;
  const report = data.report || { rows: [] };
  const rows = report.rows.filter((r) => r.orders > 0 || r.refunds > 0);
  const gapOf = (id) => (data.pricingGap || []).find((g) => g.channelId === id);
  const badge = (text, color) => (
    <span key={text} className="text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap" style={{ background: `${color}22`, color }}>{text}</span>
  );
  const cell = (label, value, sub) => (
    <div className="min-w-0">
      <div className="text-[11px] truncate" style={{ color: C.slate }}>{label}</div>
      <div className="data text-sm font-bold truncate" dir="ltr">{value}</div>
      {sub && <div className="text-[10.5px] truncate" style={{ color: C.slate }} dir="ltr">{sub}</div>}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center flex-wrap">
        {[7, 30, 90].map((n) => (
          <button key={n} onClick={() => onDays(n)} aria-pressed={days === n}
            className="px-3.5 py-2 rounded-full text-xs font-semibold"
            style={{ background: days === n ? C.ink : "var(--chip-bg)", color: days === n ? C.surface : C.ink }}>{fill(R.period, { n })}</button>
        ))}
        <span className="text-[11px]" style={{ color: C.slate }}>{R.salesNote}</span>
      </div>

      {!rows.length && <p className="panel p-5 text-sm" style={{ color: C.slate }}>{R.empty}</p>}

      {rows.map((r) => {
        const gap = gapOf(r.channelId);
        return (
          <div key={r.channelId} className="panel p-4">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
              <h3 className="display font-bold text-sm">{r.channelId === "in-store" ? T.list.presets.in_store : r.channel}</h3>
              <span className="flex gap-1.5 flex-wrap">
                {report.mostSales === r.channelId && rows.length > 1 && badge(R.mostSales, C.iris)}
                {report.mostProfit === r.channelId && rows.length > 1 && badge(R.mostProfit, C.mint)}
                {report.leastProfitable === r.channelId && rows.length > 1 && badge(R.leastProfitable, C.amber)}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {cell(R.sales, fmt(r.sales), `${r.orders} ${R.orders}`)}
              {cell(R.channelCost, fmt(r.channelCost), r.costPct === null ? "" : fill(R.costPct, { pct: r.costPct }))}
              {cell(R.profit, fmt(r.contribution), `${R.margin} ${pct(r.marginPct)}`)}
            </div>
            <div className="mt-3 pt-3 flex items-center justify-between gap-3 flex-wrap text-[11px]" style={{ borderTop: `1px solid ${C.hairline}`, color: C.slate }}>
              <span>{R.perOrder} <b className="data" dir="ltr" style={{ color: C.ink }}>{fmt(r.avgProfitPerOrder)}</b></span>
              {gap && r.channelId !== "in-store" && (
                <span>{gap.avgPct === null ? R.gapNone : fill(R.gap, { pct: gap.avgPct, n: gap.priced })}</span>
              )}
            </div>
            {r.topItems?.length > 0 && (
              <div className="mt-3">
                <div className="text-[11px] font-semibold mb-1" style={{ color: C.slate }}>{R.topItems}</div>
                {r.topItems.slice(0, 3).map((i) => (
                  <div key={i.name} className="flex items-center justify-between gap-3 py-1 text-xs">
                    <span className="truncate">{i.name} <span style={{ color: C.slate }} dir="ltr">× {i.qty}</span></span>
                    <span className="data font-semibold" dir="ltr">{fmt(i.contribution)}</span>
                  </div>
                ))}
              </div>
            )}
            {!r.costComplete && <p className="text-[11px] mt-2" style={{ color: C.amber }}>{R.incomplete}</p>}
          </div>
        );
      })}

      {report.estimatedReceipts > 0 && <p className="text-[11px] px-1" style={{ color: C.slate }}>{fill(R.estimated, { n: report.estimatedReceipts })}</p>}
    </div>
  );
}
