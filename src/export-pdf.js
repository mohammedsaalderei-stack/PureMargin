/* PDF export — opens a print-formatted window with branded report layout. */
import { moneyText } from "./Dirham.jsx";

export function exportPDF(screen, data, dateRange, business) {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-AE", { year: "numeric", month: "long", day: "numeric" });
  const timeStr = now.toLocaleTimeString("en-AE", { hour: "2-digit", minute: "2-digit" });
  const t = data.totals || {};

  const rangeLabel = { daily: "Today", weekly: "This Week", monthly: "This Month" }[dateRange] || "All Time";

  const kpiCards = [
    { label: "Total Sales", value: moneyText(t.sales), delta: t.salesDelta },
    { label: "Orders", value: (t.receipts || 0).toLocaleString("en-AE"), delta: t.receiptsDelta },
    { label: "Avg Ticket", value: moneyText(t.avgTicket), delta: t.avgTicketDelta },
    { label: "Net Profit", value: moneyText(t.netProfit), delta: null },
  ];

  const dailyRows = (data.daily || []).slice(-14).map((d) =>
    `<tr><td>${d.label}</td><td style="text-align:right">${moneyText(d.sales)}</td><td style="text-align:right">${d.receipts || 0}</td></tr>`
  ).join("");

  const branchRows = (data.stores || []).map((s) =>
    `<tr><td>${s.name}</td><td style="text-align:right">${moneyText(s.sales)}</td><td style="text-align:right">${s.receipts || 0}</td></tr>`
  ).join("");

  const itemRows = (data.items || []).slice(0, 10).map((i) =>
    `<tr><td>${i.name}</td><td style="text-align:right">${moneyText(i.revenue)}</td><td style="text-align:right">${i.qty || 0}</td><td style="text-align:right">${i.share || 0}%</td></tr>`
  ).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
  <title>PureMargin Report — ${dateStr}</title>
  <style>
    @page { size: A4; margin: 16mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', system-ui, sans-serif; color: #1A1530; background: #fff; }
    .header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 20px; border-bottom: 2px solid #8B5CF6; margin-bottom: 24px; }
    .logo { font-size: 22px; font-weight: 800; background: linear-gradient(135deg, #8B5CF6, #06B6D4); -webkit-background-clip: text; background-clip: text; color: transparent; }
    .meta { text-align: right; font-size: 11px; color: #6B6580; }
    .biz { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
    h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
    .sub { font-size: 12px; color: #6B6580; margin-bottom: 24px; }
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 28px; }
    .kpi { border: 1px solid rgba(139,92,246,0.15); border-radius: 12px; padding: 14px; }
    .kpi-label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #6B6580; margin-bottom: 6px; }
    .kpi-value { font-size: 20px; font-weight: 800; font-variant-numeric: tabular-nums; }
    .kpi-delta { font-size: 11px; margin-top: 4px; }
    .up { color: #10B981; } .down { color: #E11D48; }
    h2 { font-size: 14px; font-weight: 700; margin: 24px 0 10px; padding-bottom: 6px; border-bottom: 1px solid rgba(139,92,246,0.1); }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { text-align: left; font-weight: 600; color: #6B6580; padding: 6px 8px; border-bottom: 1px solid rgba(139,92,246,0.1); font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; }
    td { padding: 7px 8px; border-bottom: 1px solid rgba(0,0,0,0.04); }
    .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid rgba(139,92,246,0.1); font-size: 10px; color: #6B6580; text-align: center; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style></head><body>
  <div class="header">
    <div>
      <div class="logo">PureMargin</div>
      <div class="biz">${business || ""}</div>
    </div>
    <div class="meta">
      <div>${dateStr} · ${timeStr}</div>
      <div>Range: ${rangeLabel}</div>
    </div>
  </div>
  <h1>Dashboard Report</h1>
  <div class="sub">Generated from your connected POS data</div>
  <div class="kpis">
    ${kpiCards.map((k) => `<div class="kpi">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value">${k.value}</div>
      ${k.delta !== null && k.delta !== undefined ? `<div class="kpi-delta ${k.delta >= 0 ? "up" : "down"}">${k.delta >= 0 ? "▲" : "▼"} ${Math.abs(k.delta).toFixed(1)}%</div>` : ""}
    </div>`).join("")}
  </div>
  ${dailyRows ? `<h2>Sales — Last 14 Days</h2><table><thead><tr><th>Date</th><th style="text-align:right">Sales</th><th style="text-align:right">Orders</th></tr></thead><tbody>${dailyRows}</tbody></table>` : ""}
  ${branchRows ? `<h2>Branch Performance</h2><table><thead><tr><th>Branch</th><th style="text-align:right">Sales</th><th style="text-align:right">Orders</th></tr></thead><tbody>${branchRows}</tbody></table>` : ""}
  ${itemRows ? `<h2>Top Items</h2><table><thead><tr><th>Item</th><th style="text-align:right">Revenue</th><th style="text-align:right">Qty</th><th style="text-align:right">Share</th></tr></thead><tbody>${itemRows}</tbody></table>` : ""}
  <div class="footer">PureMargin — Sales intelligence for food businesses · ${dateStr}</div>
  <script>window.onload = () => { window.print(); }</script>
  </body></html>`;

  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
}
