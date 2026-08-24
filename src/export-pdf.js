/* PDF export — opens a print-formatted report in its own tab.

   Two things matter beyond the layout:

   1. The report tab has no app chrome, so it carries its own toolbar with
      "Print" and "Close". Without that, a phone browser drops you in a tab
      with no back history and no print affordance — a dead end you can only
      leave through the tab switcher.
   2. Printing is only triggered automatically on a wide screen, where a print
      dialog is a normal thing to appear. On a phone the toolbar waits for a
      tap instead, because an auto-opened share sheet over a report nobody has
      read yet is the trap itself.

   The toolbar is screen-only; the printed sheet never shows it. */
import { moneyText } from "./Dirham.jsx";

const RANGE_LABEL = { daily: "Today", weekly: "This Week", monthly: "This Month" };

const SCREEN_TITLE = {
  overview: "Dashboard Report",
  watch: "Live Service Report",
  menu: "Menu Engineering Report",
  forecast: "Forecast Report",
  advice: "Advice Report",
};

function num(v) {
  return (Number(v) || 0).toLocaleString("en-AE");
}

function pct(v) {
  return v === null || v === undefined || v === "" ? "—" : `${Number(v).toFixed(1)}%`;
}

/* Everything user-supplied goes through here. A menu item called
   "Fish & Chips <special>" must not be able to rewrite the report. */
function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function delta(v) {
  if (v === null || v === undefined) return "";
  const up = v >= 0;
  return `<div class="kpi-delta ${up ? "up" : "down"}">${up ? "▲" : "▼"} ${Math.abs(v).toFixed(1)}%</div>`;
}

function table({ head, rows, foot = "" }) {
  if (!rows.length) return "";
  const align = (i) => (i === 0 ? "" : ' class="r"');
  return `<table>
    <thead><tr>${head.map((h, i) => `<th${align(i)}>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows
      .map((r) => `<tr>${r.map((c, i) => `<td${align(i)}>${c}</td>`).join("")}</tr>`)
      .join("")}</tbody>
    ${foot}
  </table>`;
}

function section(title, body, note = "") {
  if (!body) return "";
  return `<section><h2>${esc(title)}</h2>${
    note ? `<p class="note">${esc(note)}</p>` : ""
  }${body}</section>`;
}

/* ── The sheet ────────────────────────────────────────────── */

function buildHTML({ screen, data, dateRange, business }) {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-AE", { year: "numeric", month: "long", day: "numeric" });
  const timeStr = now.toLocaleTimeString("en-AE", { hour: "2-digit", minute: "2-digit" });
  const t = data.totals || {};
  const rangeLabel = RANGE_LABEL[dateRange] || "All Time";
  const title = SCREEN_TITLE[screen] || "Report";

  const kpis = [
    { label: "Total Sales", value: moneyText(t.sales), d: t.salesDelta },
    { label: "Orders", value: num(t.receipts), d: t.receiptsDelta },
    { label: "Avg Ticket", value: moneyText(t.avgTicket), d: t.avgTicketDelta },
    { label: "Net Profit", value: moneyText(t.netProfit), d: null },
  ];

  /* A second band of the numbers people ask about after the headline four.
     Only the ones the screen actually has. */
  const extras = [
    t.marginPct !== undefined && t.marginPct !== null && { label: "Margin", value: pct(t.marginPct) },
    t.foodCostPct !== undefined && t.foodCostPct !== null && { label: "Food Cost", value: pct(t.foodCostPct) },
    t.peakHour && { label: "Peak Hour", value: esc(t.peakHour) },
    t.covers && { label: "Covers", value: num(t.covers) },
    t.refunds !== undefined && t.refunds !== null && { label: "Refunds", value: moneyText(t.refunds) },
    t.discounts !== undefined && t.discounts !== null && { label: "Discounts", value: moneyText(t.discounts) },
  ].filter(Boolean);

  const daily = data.daily || [];
  /* A bar per day, drawn in CSS so it survives printing without an image or a
     charting library. Scaled to the best day in the window. */
  const peak = Math.max(...daily.map((d) => Number(d.sales) || 0), 1);
  const chart = daily.length
    ? `<div class="chart">${daily
        .slice(-14)
        .map((d) => {
          const h = Math.max(2, Math.round(((Number(d.sales) || 0) / peak) * 100));
          return `<div class="bar-wrap"><div class="bar" style="height:${h}%"></div><div class="bar-label">${esc(
            d.label
          )}</div></div>`;
        })
        .join("")}</div>`
    : "";

  const dailyTotal = daily.reduce((s, d) => s + (Number(d.sales) || 0), 0);
  const dailyOrders = daily.reduce((s, d) => s + (Number(d.receipts) || 0), 0);

  const dailyRows = daily.slice(-14).map((d) => [
    esc(d.label),
    moneyText(d.sales),
    num(d.receipts),
    d.receipts ? moneyText((Number(d.sales) || 0) / Number(d.receipts)) : "—",
  ]);

  const storeRows = (data.stores || []).map((s) => [
    esc(s.name),
    moneyText(s.sales),
    num(s.receipts),
    t.sales ? pct(((Number(s.sales) || 0) / Number(t.sales)) * 100) : "—",
  ]);

  const itemRows = (data.items || []).slice(0, 15).map((i) => [
    esc(i.name),
    moneyText(i.revenue),
    num(i.qty),
    pct(i.share),
    i.marginPct === undefined || i.marginPct === null ? "—" : pct(i.marginPct),
  ]);

  const quadrantRows = (data.items || []).some((i) => i.quadrant)
    ? Object.entries(
        (data.items || []).reduce((acc, i) => {
          const q = i.quadrant || "—";
          acc[q] = acc[q] || { n: 0, revenue: 0 };
          acc[q].n += 1;
          acc[q].revenue += Number(i.revenue) || 0;
          return acc;
        }, {})
      ).map(([q, v]) => [esc(q), num(v.n), moneyText(v.revenue)])
    : [];

  const forecastRows = (data.forecast?.series || []).map((d) => [
    esc(d.day),
    moneyText(d.conservative),
    moneyText(d.base),
    moneyText(d.optimistic),
  ]);

  const hourRows = (data.hours || []).filter((h) => h.sales).map((h) => [
    esc(h.label ?? h.hour),
    moneyText(h.sales),
    num(h.receipts),
  ]);

  const adviceItems = (data.advice || data.insights || [])
    .slice(0, 6)
    .map((a) => `<li><strong>${esc(a.title || a.headline || "")}</strong>${
      a.body || a.detail ? `<span>${esc(a.body || a.detail)}</span>` : ""
    }</li>`)
    .join("");

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PureMargin — ${esc(title)} — ${dateStr}</title>
  <style>
    @page { size: A4; margin: 14mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif; color: #1A1530; background: #EEECF4; }
    .sheet { background: #fff; max-width: 210mm; margin: 0 auto; padding: 18mm 16mm; }

    /* Toolbar — screen only. The way out of this tab on a phone. */
    .toolbar { position: sticky; top: 0; z-index: 10; display: flex; gap: 10px; align-items: center;
      background: #1A1530; padding: 12px 16px; }
    .toolbar span { color: rgba(255,255,255,.72); font-size: 13px; margin-inline-end: auto; }
    .toolbar button { font: inherit; font-size: 14px; font-weight: 650; border: 0; cursor: pointer;
      padding: 9px 18px; border-radius: 9px; }
    .print-btn { background: #8B5CF6; color: #fff; }
    .close-btn { background: rgba(255,255,255,.14); color: #fff; }

    .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;
      padding-bottom: 16px; border-bottom: 2px solid #8B5CF6; margin-bottom: 22px; }
    .logo { font-size: 21px; font-weight: 800; color: #8B5CF6; letter-spacing: -.01em; }
    .biz { font-size: 14px; font-weight: 650; margin-top: 5px; }
    .meta { text-align: right; font-size: 11px; color: #6B6580; line-height: 1.7; white-space: nowrap; }
    .pill { display: inline-block; padding: 2px 9px; border-radius: 99px; background: rgba(139,92,246,.1);
      color: #6D3BEF; font-weight: 650; }
    h1 { font-size: 22px; font-weight: 750; letter-spacing: -.02em; }
    .sub { font-size: 12px; color: #6B6580; margin: 5px 0 24px; }

    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 12px; }
    .kpi { border: 1px solid rgba(139,92,246,.16); border-radius: 12px; padding: 13px 14px; }
    .kpi-label { font-size: 9.5px; font-weight: 650; text-transform: uppercase; letter-spacing: .08em;
      color: #6B6580; margin-bottom: 6px; }
    .kpi-value { font-size: 19px; font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
    .kpi-delta { font-size: 10.5px; margin-top: 4px; font-weight: 600; }
    .up { color: #0F9D6E; } .down { color: #E11D48; }

    .extras { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 6px; }
    .extra { border: 1px solid rgba(0,0,0,.07); border-radius: 9px; padding: 7px 12px; font-size: 11px; color: #6B6580; }
    .extra b { color: #1A1530; font-size: 12.5px; font-variant-numeric: tabular-nums; margin-inline-start: 6px; }

    section { break-inside: avoid; }
    h2 { font-size: 13px; font-weight: 750; margin: 26px 0 9px; padding-bottom: 6px;
      border-bottom: 1px solid rgba(139,92,246,.14); }
    .note { font-size: 10.5px; color: #6B6580; margin: -3px 0 9px; }

    .chart { display: flex; align-items: flex-end; gap: 5px; height: 108px; padding: 10px 0 0;
      border-bottom: 1px solid rgba(0,0,0,.07); }
    .bar-wrap { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; align-items: center;
      height: 100%; min-width: 0; }
    .bar { width: 100%; max-width: 26px; background: linear-gradient(180deg, #A78BFA, #8B5CF6);
      border-radius: 4px 4px 0 0; }
    .bar-label { font-size: 8px; color: #6B6580; margin-top: 5px; white-space: nowrap; overflow: hidden;
      text-overflow: ellipsis; max-width: 100%; }

    table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
    th { text-align: left; font-weight: 650; color: #6B6580; padding: 6px 8px; font-size: 9.5px;
      text-transform: uppercase; letter-spacing: .06em; border-bottom: 1px solid rgba(139,92,246,.14); }
    td { padding: 6.5px 8px; border-bottom: 1px solid rgba(0,0,0,.045); font-variant-numeric: tabular-nums; }
    tbody tr:nth-child(even) td { background: rgba(139,92,246,.028); }
    th.r, td.r { text-align: right; }
    tfoot td { font-weight: 700; border-top: 1px solid rgba(139,92,246,.2); border-bottom: 0; }

    ul.advice { list-style: none; font-size: 11.5px; }
    ul.advice li { padding: 8px 0 8px 14px; border-bottom: 1px solid rgba(0,0,0,.045); position: relative; }
    ul.advice li:before { content: "—"; position: absolute; left: 0; color: #8B5CF6; }
    ul.advice span { display: block; color: #6B6580; margin-top: 3px; line-height: 1.55; }

    .footer { margin-top: 30px; padding-top: 11px; border-top: 1px solid rgba(139,92,246,.14);
      font-size: 9.5px; color: #6B6580; display: flex; justify-content: space-between; gap: 12px; }

    @media (max-width: 700px) {
      .sheet { padding: 20px 16px; }
      .kpis { grid-template-columns: repeat(2, 1fr); }
      .header { flex-direction: column; }
      .meta { text-align: left; }
      table { font-size: 11px; }
    }
    @media print {
      body { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .toolbar { display: none !important; }
      .sheet { max-width: none; padding: 0; margin: 0; }
    }
  </style></head><body>

  <div class="toolbar">
    <span>PureMargin report</span>
    <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
    <button class="close-btn" onclick="window.close()">Close</button>
  </div>

  <div class="sheet">
    <div class="header">
      <div>
        <div class="logo">PureMargin</div>
        ${business ? `<div class="biz">${esc(business)}</div>` : ""}
      </div>
      <div class="meta">
        <div>${dateStr} · ${timeStr}</div>
        <div><span class="pill">${esc(rangeLabel)}</span></div>
      </div>
    </div>

    <h1>${esc(title)}</h1>
    <div class="sub">Generated from your connected POS data${
      daily.length ? ` · ${daily.length} day${daily.length === 1 ? "" : "s"} of activity` : ""
    }</div>

    <div class="kpis">
      ${kpis
        .map(
          (k) => `<div class="kpi">
        <div class="kpi-label">${esc(k.label)}</div>
        <div class="kpi-value">${k.value}</div>
        ${delta(k.d)}
      </div>`
        )
        .join("")}
    </div>

    ${
      extras.length
        ? `<div class="extras">${extras
            .map((e) => `<div class="extra">${esc(e.label)}<b>${e.value}</b></div>`)
            .join("")}</div>`
        : ""
    }

    ${section("Sales Shape", chart, daily.length > 14 ? "Last 14 days of the selected range." : "")}

    ${section(
      "Daily Detail",
      table({
        head: ["Date", "Sales", "Orders", "Avg Ticket"],
        rows: dailyRows,
        foot: `<tfoot><tr><td>Total</td><td class="r">${moneyText(dailyTotal)}</td><td class="r">${num(
          dailyOrders
        )}</td><td class="r">${dailyOrders ? moneyText(dailyTotal / dailyOrders) : "—"}</td></tr></tfoot>`,
      })
    )}

    ${section(
      "Branch Performance",
      table({ head: ["Branch", "Sales", "Orders", "Share"], rows: storeRows })
    )}

    ${section(
      "Trade by Hour",
      table({ head: ["Hour", "Sales", "Orders"], rows: hourRows })
    )}

    ${section(
      "Top Items",
      table({ head: ["Item", "Revenue", "Qty", "Share", "Margin"], rows: itemRows }),
      (data.items || []).length > 15 ? "The fifteen largest by revenue." : ""
    )}

    ${section(
      "Menu Quadrants",
      table({ head: ["Quadrant", "Items", "Revenue"], rows: quadrantRows })
    )}

    ${section(
      "Forecast",
      table({ head: ["Day", "Conservative", "Base", "Optimistic"], rows: forecastRows })
    )}

    ${section("Notes", adviceItems ? `<ul class="advice">${adviceItems}</ul>` : "")}

    <div class="footer">
      <span>PureMargin — sales intelligence for food businesses</span>
      <span>${dateStr} · ${esc(rangeLabel)}</span>
    </div>
  </div>

  <script>
    /* Only a wide screen gets the dialog unasked. Phones use the toolbar, so
       nobody lands behind a share sheet they didn't ask for. */
    if (window.matchMedia("(min-width: 900px)").matches) {
      window.addEventListener("load", function () { setTimeout(function () { window.print(); }, 250); });
    }
  </script>
  </body></html>`;
}

export function exportPDF(screen, data, dateRange, business) {
  if (!data) return;
  const html = buildHTML({ screen, data, dateRange, business });

  const w = window.open("", "_blank");
  if (w) {
    w.document.write(html);
    w.document.close();
    return;
  }

  /* Popup blocked — hand over the report as a file rather than losing it.
     Opening it locally still prints to PDF the same way. */
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `puremargin-${screen}-${new Date().toISOString().slice(0, 10)}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
