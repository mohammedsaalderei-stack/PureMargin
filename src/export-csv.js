/* CSV export — serialises the current screen's data into a downloadable file.

   Sheets open these straight from a download, so two details matter: a BOM, or
   Excel mangles Arabic item names, and CRLF line endings, which is what Excel
   expects. Each file also opens with a small header block saying what it is —
   a spreadsheet found six months later should explain itself. */

function csvEscape(val) {
  const s = String(val ?? "");
  /* A leading =, +, - or @ is executed as a formula by Excel and Sheets. */
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  if (/[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

function download(filename, rows) {
  const csv = rows.map((r) => (r || []).map(csvEscape).join(",")).join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  // Firefox ignores a click on an anchor that was never in the document.
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const RANGE_LABEL = { daily: "Today", weekly: "This week", monthly: "This month" };

function preamble(screen, dateRange, business) {
  const now = new Date();
  return [
    ["PureMargin export"],
    ["Screen", screen],
    ["Range", RANGE_LABEL[dateRange] || "All time"],
    ...(business ? [["Business", business]] : []),
    ["Generated", now.toISOString()],
    [],
  ];
}

/* Only the totals the payload actually carries. A column of zeroes for a
   metric this screen never measured reads as a real zero. */
function totalsRows(t) {
  const fields = [
    ["Sales", t.sales],
    ["Orders", t.receipts],
    ["Avg ticket", t.avgTicket],
    ["Net profit", t.netProfit],
    ["Margin %", t.marginPct],
    ["Food cost %", t.foodCostPct],
    ["Peak hour", t.peakHour],
    ["Covers", t.covers],
    ["Refunds", t.refunds],
    ["Discounts", t.discounts],
    ["Sales delta %", t.salesDelta],
    ["Orders delta %", t.receiptsDelta],
    ["Avg ticket delta %", t.avgTicketDelta],
  ];
  return fields
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([label, v]) => [label, v]);
}

function block(rows, title, head, body) {
  if (!body.length) return;
  rows.push([title]);
  rows.push(head);
  body.forEach((r) => rows.push(r));
  rows.push([]);
}

export function exportCSV(screen, data, dateRange, business) {
  if (!data) return;
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `puremargin-${screen}-${dateRange || "all"}-${stamp}.csv`;
  const rows = preamble(screen, dateRange, business);

  if (screen === "menu") {
    block(
      rows,
      "Menu items",
      ["Item", "Quadrant", "Orders", "Revenue", "Per order", "Margin %", "Share %"],
      (data.items || []).map((i) => [
        i.name,
        i.quadrant || "",
        i.qty || 0,
        i.revenue || 0,
        i.perUnit || 0,
        i.marginPct ?? "",
        i.share ?? "",
      ])
    );
  } else if (screen === "forecast") {
    block(
      rows,
      "Forecast",
      ["Day", "Conservative", "Base", "Optimistic"],
      (data.forecast?.series || []).map((d) => [d.day, d.conservative || 0, d.base || 0, d.optimistic || 0])
    );
  } else {
    /* Overview and Watch share a payload, so they share an export. */
    const t = data.totals || {};
    block(rows, "Summary", ["Metric", "Value"], totalsRows(t));

    block(
      rows,
      "Daily breakdown",
      ["Date", "Sales", "Orders", "Avg ticket"],
      (data.daily || []).map((d) => [
        d.label,
        d.sales || 0,
        d.receipts || 0,
        d.receipts ? Number(((d.sales || 0) / d.receipts).toFixed(2)) : "",
      ])
    );

    block(
      rows,
      "Branch breakdown",
      ["Branch", "Sales", "Orders", "Share %"],
      (data.stores || []).map((s) => [
        s.name,
        s.sales || 0,
        s.receipts || 0,
        t.sales ? Number((((s.sales || 0) / t.sales) * 100).toFixed(1)) : "",
      ])
    );

    block(
      rows,
      "Trade by hour",
      ["Hour", "Sales", "Orders"],
      (data.hours || []).map((h) => [h.label ?? h.hour, h.sales || 0, h.receipts || 0])
    );

    block(
      rows,
      "Top items",
      ["Item", "Revenue", "Orders", "Share %", "Margin %"],
      (data.items || []).slice(0, 25).map((i) => [
        i.name,
        i.revenue || 0,
        i.qty || 0,
        i.share ?? "",
        i.marginPct ?? "",
      ])
    );

    block(
      rows,
      "Forecast",
      ["Day", "Conservative", "Base", "Optimistic"],
      (data.forecast?.series || []).map((d) => [d.day, d.conservative || 0, d.base || 0, d.optimistic || 0])
    );
  }

  /* Nothing but the header block means the screen had nothing to give. */
  if (rows.length <= preamble(screen, dateRange, business).length) {
    rows.push(["No exportable data for this screen"]);
  }

  download(filename, rows);
}
