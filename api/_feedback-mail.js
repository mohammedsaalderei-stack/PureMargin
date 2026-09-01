import { shell, row } from "./_mail.js";
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

  /* Same layout as every other message the product sends. It used to build
     its own card, which drifted from the others the moment either changed. */
  const html = shell({
    title: "Unhelpful answer reported",
    intro: "Somebody pressed thumbs-down and told us why.",
    blocks: [
      row("Reason", `${reason}${report.detail ? ` — ${report.detail}` : ""}`),
      row("User", `${report.user || "unknown"} · ${report.lang || "unknown"} · ${report.at || ""}`),
      row("Question", report.question || "—"),
      row("Answer", report.answer || "—"),
    ],
  });

  return { subject, html, text };
}
