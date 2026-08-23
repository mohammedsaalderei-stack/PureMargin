/* The "unhelpful answer" report, as mail.

   Kept apart from _mail.js so the transport stays a transport: this file only
   knows how a feedback report reads. Plain text carries everything, and the
   HTML is the same content with the question and answer set apart so a long
   report is still skimmable in an inbox. */

const REASONS = {
  wrongNumbers: "Wrong numbers",
  missedPoint: "Missed the point",
  tooVague: "Too vague",
  wrongLanguage: "Wrong language",
  other: "Other",
};

const escape = (s) =>
  String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

const block = (label, body) => `
  <div style="margin:0 0 16px">
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6B6580;margin-bottom:4px">${label}</div>
    <div style="font-size:14px;line-height:1.6;white-space:pre-wrap">${escape(body) || "—"}</div>
  </div>`;

export function feedbackMail(report) {
  const reason = REASONS[report.reason] || REASONS.other;
  const subject = `PureMargin feedback: ${reason} — ${report.user}`;

  const text = [
    `Unhelpful answer reported by ${report.user}`,
    `Reason: ${reason}${report.detail ? ` — ${report.detail}` : ""}`,
    `Language: ${report.lang || "unknown"}`,
    `At: ${report.at}`,
    ``,
    `Question:`,
    report.question || "—",
    ``,
    `Answer:`,
    report.answer || "—",
  ].join("\n");

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:32px;background:#F7F6FB;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1A1530">
    <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid rgba(139,92,246,.15);border-radius:14px;padding:32px">
      <div style="font-size:18px;font-weight:800;color:#8B5CF6;margin-bottom:24px">PureMargin</div>
      <div style="font-size:16px;font-weight:700;margin-bottom:20px">Unhelpful answer reported</div>
      ${block("Reason", report.detail ? `${reason} — ${report.detail}` : reason)}
      ${block("User", `${report.user} · ${report.lang || "unknown"} · ${report.at}`)}
      ${block("Question", report.question)}
      ${block("Answer", report.answer)}
    </div>
  </body></html>`;

  return { subject, html, text };
}
