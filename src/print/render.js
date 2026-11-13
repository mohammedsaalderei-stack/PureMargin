/* Drawing a receipt, a kitchen ticket or a shift report onto a canvas.

   Each `draw…` returns a sheet — `{ width, height, parts }`, the parts being
   canvases one under the other; nearly always there is one. One drawing
   serves every printer: it is rasterised for an ESC/POS printer,
   turned into a picture for AirPrint, and shown in the browser's own print
   dialog. Laid out in dots at the printer's width, so what is drawn is what
   comes out of the head, column for column.

   Text that contains Arabic (or Urdu) is laid out right-to-left by the canvas
   itself, which shapes it as the browser does on screen. A line that mixes a
   label and an amount keeps the amount on the outside edge in either
   direction, the way a printed bill reads. */

const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const FONT = '"Helvetica Neue", "Geeza Pro", "Noto Sans Arabic", Arial, sans-serif';

/* How tall one canvas is allowed to get. Safari on an iPad refuses a canvas
   over about sixteen million pixels, which at 576 dots across is 29,000
   rows; this stays well inside it. */
const START_ROWS = 2400;
const MAX_ROWS = 16000;

function makeCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function prime(canvas) {
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "top";
  return ctx;
}

/* A small layout engine: a cursor moving down the paper.

   The paper is as long as the receipt. The canvas used to be 4000 rows and
   that was that: a receipt with more lines than fit — sixty items, a long
   shift report — was drawn off the end of it and the total, which is at the
   bottom, never reached the printer. Now the canvas grows as the cursor
   nears its end, and a drawing longer than one canvas is allowed to be continues on
   another. What comes back is every part, in order, and they print one
   under the other with no gap. */
function page(width, { rtl = false } = {}) {
  let canvas = makeCanvas(width, START_ROWS);
  let ctx = prime(canvas);
  const done = [];
  const pad = Math.round(width * 0.02);
  let y = pad;
  const base = Math.round(width / 21);

  const font = (scale = 1, bold = false) => { ctx.font = `${bold ? "700" : "400"} ${Math.round(base * scale)}px ${FONT}`; };
  const lineHeight = (scale = 1) => Math.round(base * scale * 1.32);

  /* The part drawn so far, cut to the length used. */
  const cutAt = (rows) => {
    const out = makeCanvas(width, Math.max(1, rows));
    prime(out).drawImage(canvas, 0, 0);
    return out;
  };

  /* Make sure `rows` more dots fit under the cursor. */
  const room = (rows) => {
    if (y + rows <= canvas.height) return;
    if (canvas.height < MAX_ROWS) {
      const taller = makeCanvas(width, Math.min(MAX_ROWS, Math.max(canvas.height * 2, y + rows)));
      const next = prime(taller);
      next.drawImage(canvas, 0, 0);
      canvas = taller;
      ctx = next;
      if (y + rows <= canvas.height) return;
    }
    done.push(cutAt(y));
    canvas = makeCanvas(width, START_ROWS);
    ctx = prime(canvas);
    y = 0;
  };

  const wrap = (text, maxWidth) => {
    const words = String(text ?? "").split(/\s+/).filter(Boolean);
    const lines = [];
    let current = "";
    for (const w of words) {
      const next = current ? `${current} ${w}` : w;
      if (ctx.measureText(next).width > maxWidth && current) { lines.push(current); current = w; }
      else current = next;
    }
    if (current) lines.push(current);
    return lines.length ? lines : [""];
  };

  const api = {
    get y() { return done.reduce((n, c) => n + c.height, 0) + y; },
    gap: (n = 0.5) => { y += Math.round(base * n); },
    center: (text, { scale = 1, bold = false } = {}) => {
      font(scale, bold);
      for (const l of wrap(text, width - pad * 2)) {
        room(lineHeight(scale));
        font(scale, bold);
        ctx.direction = RTL.test(l) ? "rtl" : "ltr";
        ctx.textAlign = "center";
        ctx.fillText(l, width / 2, y);
        y += lineHeight(scale);
      }
    },
    /* A label on the reading side, an amount on the other. */
    row: (label, value = "", { scale = 1, bold = false, indent = 0 } = {}) => {
      font(scale, bold);
      const valueWidth = value ? ctx.measureText(String(value)).width + base : 0;
      const lines = wrap(label, width - pad * 2 - valueWidth - indent);
      lines.forEach((l, i) => {
        room(lineHeight(scale));
        font(scale, bold);
        const labelRtl = RTL.test(l) || (rtl && !/[A-Za-z]/.test(l));
        ctx.direction = labelRtl ? "rtl" : "ltr";
        ctx.textAlign = rtl ? "right" : "left";
        ctx.fillText(l, rtl ? width - pad - indent : pad + indent, y);
        if (i === 0 && value) {
          ctx.direction = "ltr";
          ctx.textAlign = rtl ? "left" : "right";
          ctx.fillText(String(value), rtl ? pad : width - pad, y);
        }
        y += lineHeight(scale);
      });
    },
    rule: (dashed = true) => {
      room(base);
      ctx.save();
      ctx.lineWidth = Math.max(1, Math.round(width / 300));
      if (dashed) ctx.setLineDash([Math.round(base / 2), Math.round(base / 3)]);
      ctx.beginPath();
      const mid = y + Math.round(base * 0.4);
      ctx.moveTo(pad, mid);
      ctx.lineTo(width - pad, mid);
      ctx.stroke();
      ctx.restore();
      y += Math.round(base * 0.9);
    },
    /* The whole drawing: every part, each cut to the length it used. */
    finish: () => {
      room(pad * 2);
      const parts = [...done, cutAt(y + pad * 2)];
      return { width, height: parts.reduce((n, c) => n + c.height, 0), parts };
    },
  };
  return api;
}

const money = (n) => (Number(n) || 0).toFixed(2);
/* An Arabic date comes with invisible direction marks between its numbers
   ("12‏/11‏/2026"), there to lay it out inside a sentence. In a column of its
   own they pull it apart — the day printed at one end of the line and the
   rest at the other — so they are taken out and it reads as it is written. */
const when = (iso, locale) => new Date(iso).toLocaleString(locale, {
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
}).replace(/[‎‏؜]/g, "");

/* A customer's receipt — a tax invoice when the business has a TRN. */
export function drawReceipt(receipt, { width = 576, settings = {}, labels, locale = "en-AE", rtl = false, customer = null, copy = false } = {}) {
  const L = labels;
  const p = page(width, { rtl });
  const r = settings.receipt || {};
  if (r.business) p.center(r.business, { scale: 1.45, bold: true });
  if (r.address) p.center(r.address, { scale: 0.85 });
  if (r.phone) p.center(r.phone, { scale: 0.85 });
  if (r.trn) p.center(`${L.trn} ${r.trn}`, { scale: 0.85 });
  if (r.header) { p.gap(0.3); p.center(r.header, { scale: 0.9 }); }
  p.gap(0.4);
  const refund = receipt.receipt_type === "REFUND";
  p.center(refund ? L.refund : r.trn ? L.taxInvoice : L.receipt, { scale: 1.1, bold: true });
  if (copy) p.center(L.copy, { scale: 0.85 });
  p.rule();
  p.row(L.number, receipt.receipt_number, { scale: 0.85 });
  p.row(L.date, when(receipt.receipt_date, locale), { scale: 0.85 });
  if (refund && receipt.refund_for) p.row(L.refundFor, receipt.refund_for, { scale: 0.85 });
  if (receipt.cashier) p.row(L.cashier, receipt.cashier, { scale: 0.85 });
  const order = [L.orderTypes?.[receipt.order_type], receipt.table ? `${L.table} ${receipt.table}` : "", receipt.ticket_name || ""]
    .filter(Boolean).join(" · ");
  if (order) p.row(order, "", { scale: 0.85 });
  if (customer?.name) p.row(L.customer, customer.name, { scale: 0.85 });
  p.rule();

  for (const li of receipt.line_items || []) {
    p.row(`${li.quantity} × ${li.item_name}${li.variant_name ? ` · ${li.variant_name}` : ""}`, money(li.gross_total_money ?? li.total_money), { bold: true });
    for (const m of li.line_modifiers || []) {
      p.row(`+ ${m.name}`, m.price ? money(m.price * li.quantity) : "", { scale: 0.85, indent: 24 });
    }
    if (li.note) p.row(li.note, "", { scale: 0.8, indent: 24 });
    if (Number(li.total_discount) > 0 && !refund) p.row(L.discount, `-${money(li.total_discount)}`, { scale: 0.85, indent: 24 });
  }
  p.rule();
  p.row(L.subtotal, money(receipt.subtotal_money));
  if (Number(receipt.total_discount) > 0) p.row(L.discount, `-${money(receipt.total_discount)}`);
  if (Number(receipt.total_tax) > 0 || receipt.vat_pct) {
    const vatLabel = receipt.vat_mode === "inclusive" ? `${L.vatIncluded} ${receipt.vat_pct}%` : `${L.vat} ${receipt.vat_pct}%`;
    p.row(vatLabel, money(receipt.total_tax));
  }
  p.gap(0.2);
  p.row(refund ? L.refunded : L.total, `${L.currency} ${money(receipt.total_money)}`, { scale: 1.35, bold: true });
  p.gap(0.2);
  for (const pay of receipt.payments || []) {
    p.row(pay.name, money(pay.received ?? pay.money_amount), { scale: 0.95 });
    if (Number(pay.change) > 0) p.row(L.change, money(pay.change), { scale: 0.95 });
  }
  if (Number(receipt.points_earned) > 0) p.row(L.pointsEarned, money(receipt.points_earned), { scale: 0.85 });
  if (Number(receipt.points_redeemed) > 0) p.row(L.pointsRedeemed, money(receipt.points_redeemed), { scale: 0.85 });
  p.rule();
  if (r.footer) p.center(r.footer, { scale: 0.9 });
  p.center(L.thanks, { scale: 0.9 });
  return p.finish();
}

/* What the kitchen needs, large: what to make, for which table, and when. */
export function drawKitchen(order, { width = 576, labels, locale = "en-AE", rtl = false, added = false } = {}) {
  const L = labels;
  const p = page(width, { rtl });
  p.center(added ? L.kitchenAdded : L.kitchen, { scale: 1.1, bold: true });
  const head = [L.orderTypes?.[order.orderType], order.table ? `${L.table} ${order.table}` : "", order.name || ""]
    .filter(Boolean).join(" · ");
  if (head) p.center(head, { scale: 1.5, bold: true });
  p.center(new Date(order.at || Date.now()).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }), { scale: 0.9 });
  if (order.by) p.center(order.by, { scale: 0.8 });
  p.rule(false);
  for (const li of order.lines) {
    p.row(`${li.qty} × ${li.name}`, "", { scale: 1.45, bold: true });
    for (const m of li.addons || []) p.row(`+ ${m}`, "", { scale: 1.1, indent: 30 });
    if (li.note) p.row(`» ${li.note}`, "", { scale: 1.1, indent: 30 });
    p.gap(0.3);
  }
  if (order.note) { p.rule(); p.row(order.note, "", { scale: 1.1 }); }
  return p.finish();
}

/* The end-of-shift report, for the cash bag. */
export function drawShift(shift, summary, { width = 576, labels, locale = "en-AE", rtl = false, business = "" } = {}) {
  const L = labels;
  const p = page(width, { rtl });
  if (business) p.center(business, { scale: 1.3, bold: true });
  p.center(shift.closedAt ? L.zReport : L.xReport, { scale: 1.1, bold: true });
  p.rule();
  p.row(L.opened, when(shift.openedAt, locale), { scale: 0.85 });
  if (shift.openedBy) p.row(L.by, shift.openedBy, { scale: 0.85 });
  if (shift.closedAt) p.row(L.closed, when(shift.closedAt, locale), { scale: 0.85 });
  if (shift.closedBy) p.row(L.by, shift.closedBy, { scale: 0.85 });
  p.rule();
  p.row(L.grossSales, money(summary.grossSales));
  p.row(L.discounts, `-${money(summary.discounts)}`);
  p.row(L.refunds, `-${money(summary.refunded)}`);
  p.row(L.netSales, money(summary.netSales), { bold: true });
  p.row(L.tax, money(summary.tax));
  p.row(L.receiptsCount, String(summary.receipts));
  p.rule();
  for (const pay of summary.payments) p.row(pay.name, money(pay.amount));
  p.rule();
  p.row(L.float, money(summary.cash.float));
  p.row(L.cashSales, money(summary.cash.sales));
  p.row(L.cashRefunds, `-${money(summary.cash.refunds)}`);
  p.row(L.payIns, money(summary.cash.payIns));
  p.row(L.payOuts, `-${money(summary.cash.payOuts)}`);
  p.row(L.expected, money(summary.cash.expected), { bold: true });
  if (shift.counted !== undefined) {
    p.row(L.counted, money(shift.counted), { bold: true });
    p.row(L.difference, money(shift.difference), { bold: true });
  }
  return p.finish();
}

/* A test page: proves the connection, the paper width and the cutter. */
export function drawTest(printer, { width = 576, labels, rtl = false } = {}) {
  const p = page(width, { rtl });
  p.center("PureMargin", { scale: 1.5, bold: true });
  p.center(labels.testTitle, { scale: 1.1, bold: true });
  p.rule();
  p.row(labels.printerName, printer.name || "—");
  p.row(labels.paper, `${printer.paper || 80} mm`);
  p.row("English", "0123456789");
  p.row("العربية", "٠١٢٣٤٥٦٧٨٩");
  p.rule();
  p.center(labels.testOk, { scale: 0.9 });
  return p.finish();
}
