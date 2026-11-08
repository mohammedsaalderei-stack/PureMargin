/* A register receipt, as an email to the customer.

   The business's name heads it, not ours: this is the shop's receipt, sent
   on its behalf, and somebody reading it on the way home is looking for
   where they ate. A tax invoice when the store or business has a TRN, as on
   paper.

   The wording lives here rather than coming from the browser. A label the
   client sends would be text of anybody's choosing going out from our
   sending address to an address of anybody's choosing, and the only thing
   that makes this not a way to send arbitrary mail is that every word in it
   is either ours or a fact from the receipt. */

import { esc } from "./_mail.js";
import { getJSON, setJSON } from "./_store.js";

/* How often. A receipt can be sent to the same customer again (a typo, a
   second address) but not a hundred times, and a business sends at most so
   many a day — enough for a busy counter, too few to be worth abusing. */
export const PER_RECEIPT = 3;
export const PER_DAY = 500;

export async function allowSend(orgId, number, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  const receiptKey = `register:${orgId}:mailed:${number}`;
  const dayKey = `register:${orgId}:mailday:${day}`;
  const [sentForReceipt, sentToday] = await Promise.all([getJSON(receiptKey), getJSON(dayKey)]);
  if ((Number(sentForReceipt) || 0) >= PER_RECEIPT) return { error: "toomany" };
  if ((Number(sentToday) || 0) >= PER_DAY) return { error: "daily" };
  await Promise.all([setJSON(receiptKey, (Number(sentForReceipt) || 0) + 1), setJSON(dayKey, (Number(sentToday) || 0) + 1)]);
  return { ok: true };
}

export const validEmail = (s) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(String(s || "").trim());

const LABELS = {
  en: { receipt: "Receipt", taxInvoice: "Tax invoice", refund: "Refund", trn: "TRN", number: "No.", date: "Date", cashier: "Served by",
    subtotal: "Subtotal", discount: "Discount", vat: "VAT {pct}%", vatIncluded: "Includes VAT {pct}%", total: "Total", paid: "Paid", change: "Change",
    subject: "Your receipt from {business}", subjectRefund: "Your refund from {business}", thanks: "Thank you.", sentBy: "Sent by PureMargin on behalf of {business}." },
  ar: { receipt: "إيصال", taxInvoice: "فاتورة ضريبية", refund: "استرداد", trn: "الرقم الضريبي", number: "رقم", date: "التاريخ", cashier: "الكاشير",
    subtotal: "المجموع الفرعي", discount: "الخصم", vat: "ضريبة القيمة المضافة {pct}%", vatIncluded: "شامل الضريبة {pct}%", total: "الإجمالي", paid: "المدفوع", change: "الباقي",
    subject: "إيصالك من {business}", subjectRefund: "استردادك من {business}", thanks: "شكرًا لك.", sentBy: "أُرسل عبر PureMargin نيابةً عن {business}." },
  hi: { receipt: "रसीद", taxInvoice: "टैक्स इनवॉइस", refund: "रिफ़ंड", trn: "TRN", number: "नं.", date: "तारीख़", cashier: "कैशियर",
    subtotal: "उप-योग", discount: "छूट", vat: "VAT {pct}%", vatIncluded: "VAT {pct}% सहित", total: "कुल", paid: "भुगतान", change: "बाक़ी",
    subject: "{business} से आपकी रसीद", subjectRefund: "{business} से आपका रिफ़ंड", thanks: "धन्यवाद।", sentBy: "{business} की ओर से PureMargin द्वारा भेजा गया।" },
  ur: { receipt: "رسید", taxInvoice: "ٹیکس انوائس", refund: "واپسی", trn: "TRN", number: "نمبر", date: "تاریخ", cashier: "کیشیئر",
    subtotal: "ذیلی کل", discount: "رعایت", vat: "VAT {pct}%", vatIncluded: "VAT {pct}% شامل", total: "کل", paid: "ادا شدہ", change: "بقایا",
    subject: "{business} سے آپ کی رسید", subjectRefund: "{business} سے آپ کی واپسی", thanks: "شکریہ۔", sentBy: "{business} کی جانب سے PureMargin نے بھیجا۔" },
  tl: { receipt: "Resibo", taxInvoice: "Tax invoice", refund: "Refund", trn: "TRN", number: "Blg.", date: "Petsa", cashier: "Kahera",
    subtotal: "Subtotal", discount: "Diskwento", vat: "VAT {pct}%", vatIncluded: "Kasama ang VAT {pct}%", total: "Kabuuan", paid: "Bayad", change: "Sukli",
    subject: "Ang resibo mo mula sa {business}", subjectRefund: "Ang refund mo mula sa {business}", thanks: "Salamat.", sentBy: "Ipinadala ng PureMargin para sa {business}." },
};
const RTL = new Set(["ar", "ur"]);

const fill = (s, vars) => String(s).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));
const money = (n) => (Number(n) || 0).toFixed(2);

export const receiptLanguages = Object.keys(LABELS);

/* `business` is the name to head it with; `store` the selling store's
   address, phone and TRN, each falling back to the business-wide one in
   `receiptSettings`. */
export function receiptMail(receipt, { business = "", store = {}, receiptSettings = {}, lang = "en", currency = "AED" } = {}) {
  const L = LABELS[lang] || LABELS.en;
  const dir = RTL.has(lang) ? "rtl" : "ltr";
  const start = dir === "rtl" ? "right" : "left";
  const end = dir === "rtl" ? "left" : "right";
  const name = business || receiptSettings.business || "";
  const address = store.address || receiptSettings.address || "";
  const phone = store.phone || receiptSettings.phone || "";
  const trn = store.trn || receiptSettings.trn || "";
  const refund = receipt.receipt_type === "REFUND";
  const title = refund ? L.refund : trn ? L.taxInvoice : L.receipt;
  const when = new Date(receipt.receipt_date).toISOString().replace("T", " ").slice(0, 16);

  const line = (label, value, { strong = false, muted = false } = {}) => `<tr>
      <td style="padding:4px 0;text-align:${start};font-size:${strong ? 16 : 14}px;${strong ? "font-weight:800;" : ""}color:${muted ? "#6B7280" : "#111827"}">${esc(label)}</td>
      <td dir="ltr" style="padding:4px 0;text-align:${end};font-size:${strong ? 16 : 14}px;${strong ? "font-weight:800;" : ""}color:${muted ? "#6B7280" : "#111827"};white-space:nowrap">${esc(value)}</td>
    </tr>`;

  const items = (receipt.line_items || []).map((li) => {
    const label = `${li.quantity} × ${li.item_name}${li.variant_name ? ` · ${li.variant_name}` : ""}`;
    const extras = (li.line_modifiers || []).map((m) => m.name).join(", ");
    return `<tr>
      <td style="padding:8px 0 2px;text-align:${start};font-size:14px;font-weight:600;color:#111827">${esc(label)}${extras ? `<div style="font-size:12px;font-weight:400;color:#6B7280">+ ${esc(extras)}</div>` : ""}</td>
      <td dir="ltr" style="padding:8px 0 2px;text-align:${end};font-size:14px;color:#111827;white-space:nowrap;vertical-align:top">${money(li.gross_total_money ?? li.total_money)}</td>
    </tr>`;
  }).join("");

  const pct = receipt.vat_pct;
  const totals = [
    line(L.subtotal, money(receipt.subtotal_money), { muted: true }),
    Number(receipt.total_discount) > 0 ? line(L.discount, `−${money(receipt.total_discount)}`, { muted: true }) : "",
    Number(receipt.total_tax) > 0 || pct ? line(fill(receipt.vat_mode === "inclusive" ? L.vatIncluded : L.vat, { pct }), money(receipt.total_tax), { muted: true }) : "",
    line(L.total, `${currency} ${money(receipt.total_money)}`, { strong: true }),
  ].join("");

  const payments = (receipt.payments || []).map((p) => [
    line(`${L.paid} · ${p.name || p.type || ""}`, money(p.received ?? p.money_amount), { muted: true }),
    Number(p.change) > 0 ? line(L.change, money(p.change), { muted: true }) : "",
  ].join("")).join("");

  const header = [address, phone, trn ? `${L.trn} ${trn}` : ""].filter(Boolean).map((t) => esc(t)).join("<br>");
  const html = `<!DOCTYPE html><html dir="${dir}"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light">
    <title>${esc(title)}</title></head>
    <body dir="${dir}" style="margin:0;padding:24px;background:#F5F3FF;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#111827">
    <div style="max-width:440px;margin:0 auto;background:#fff;border:1px solid rgba(139,92,246,.15);border-radius:14px;padding:28px">
      <div style="text-align:center;font-size:20px;font-weight:800">${esc(name)}</div>
      ${header ? `<div style="text-align:center;font-size:12px;line-height:1.6;color:#6B7280;margin-top:4px">${header}</div>` : ""}
      <div style="text-align:center;font-size:15px;font-weight:800;margin:18px 0 6px">${esc(title)}</div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
        ${line(L.number, receipt.receipt_number, { muted: true })}
        ${line(L.date, when, { muted: true })}
        ${receipt.cashier ? line(L.cashier, receipt.cashier, { muted: true }) : ""}
      </table>
      <div style="border-top:1px dashed #D1D5DB;margin:12px 0"></div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">${items}</table>
      <div style="border-top:1px dashed #D1D5DB;margin:12px 0"></div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">${totals}${payments}</table>
      <div style="text-align:center;font-size:14px;font-weight:700;margin-top:18px">${esc(L.thanks)}</div>
      <div style="text-align:center;font-size:11px;color:#9CA3AF;margin-top:16px">${esc(fill(L.sentBy, { business: name || "PureMargin" }))}</div>
    </div></body></html>`;

  const text = [
    name, address, phone, trn ? `${L.trn} ${trn}` : "", "", title, `${L.number} ${receipt.receipt_number}`, `${L.date} ${when}`, "",
    ...(receipt.line_items || []).map((li) => `${li.quantity} x ${li.item_name}${li.variant_name ? ` · ${li.variant_name}` : ""}  ${money(li.gross_total_money ?? li.total_money)}`),
    "", `${L.total}: ${currency} ${money(receipt.total_money)}`, "", L.thanks,
  ].filter((x, i, a) => x !== "" || a[i - 1] !== "").join("\n");

  return { subject: fill(refund ? L.subjectRefund : L.subject, { business: name || "PureMargin" }), html, text };
}
