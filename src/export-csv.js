/* CSV export — serialises the current screen's data into a downloadable file. */

function csvEscape(val) {
  const s = String(val ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function download(filename, rows) {
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportCSV(screen, data, dateRange) {
  const now = new Date().toISOString().slice(0, 10);
  const prefix = `puremargin-${screen}-${dateRange || "all"}-${now}`;

  if (screen === "overview" || screen === "watch") {
    const rows = [["Metric", "Value"]];
    const t = data.totals || {};
    rows.push(["Sales", t.sales || 0]);
    rows.push(["Orders", t.receipts || 0]);
    rows.push(["Avg Ticket", t.avgTicket || 0]);
    rows.push(["Peak Hour", t.peakHour || "—"]);
    rows.push(["Net Profit", t.netProfit || 0]);
    rows.push(["Margin %", t.marginPct || 0]);
    rows.push(["Sales Delta %", t.salesDelta || 0]);
    rows.push(["Receipts Delta %", t.receiptsDelta || 0]);

    if (data.daily?.length) {
      rows.push([]);
      rows.push(["Daily Breakdown"]);
      rows.push(["Date", "Sales", "Orders"]);
      data.daily.forEach((d) => rows.push([d.label, d.sales || 0, d.receipts || 0]));
    }
    if (data.stores?.length) {
      rows.push([]);
      rows.push(["Branch Breakdown"]);
      rows.push(["Branch", "Sales", "Orders"]);
      data.stores.forEach((s) => rows.push([s.name, s.sales || 0, s.receipts || 0]));
    }
    if (data.items?.length) {
      rows.push([]);
      rows.push(["Top Items"]);
      rows.push(["Item", "Revenue", "Orders", "Share %"]);
      data.items.slice(0, 20).forEach((i) => rows.push([i.name, i.revenue || 0, i.qty || 0, i.share || 0]));
    }
    download(`${prefix}.csv`, rows);
  } else if (screen === "menu") {
    const rows = [["Item", "Quadrant", "Orders", "Revenue", "Per Order", "Margin %"]];
    (data.items || []).forEach((i) =>
      rows.push([i.name, i.quadrant || "—", i.qty || 0, i.revenue || 0, i.perUnit || 0, i.marginPct || "—"])
    );
    download(`${prefix}.csv`, rows);
  } else if (screen === "forecast") {
    const rows = [["Day", "Conservative", "Base", "Optimistic"]];
    (data.forecast?.series || []).forEach((d) =>
      rows.push([d.day, d.conservative || 0, d.base || 0, d.optimistic || 0])
    );
    download(`${prefix}.csv`, rows);
  } else {
    download(`${prefix}.csv`, [["No exportable data for this screen"]]);
  }
}
