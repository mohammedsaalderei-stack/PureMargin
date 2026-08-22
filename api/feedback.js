import { requireAuth } from "./_auth.js";

/* Feedback on an unhelpful answer.
   Serverless functions have no durable storage, so this does two things:
   writes a structured line to the platform logs (always), and POSTs to a
   webhook if one is configured (Slack, Discord, Zapier, or your own
   endpoint all accept this shape). Set FEEDBACK_WEBHOOK_URL to receive it. */

const MAX = 4000;
const REASONS = ["wrongNumbers", "missedPoint", "tooVague", "wrongLanguage", "other"];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST." });
  }
  const session = await requireAuth(req, res);
  if (!session) return;

  const { question = "", answer = "", reason = "other", detail = "", lang = "" } = req.body || {};

  const report = {
    at: new Date().toISOString(),
    user: session.username,
    lang,
    reason: REASONS.includes(reason) ? reason : "other",
    detail: String(detail).slice(0, MAX),
    question: String(question).slice(0, MAX),
    answer: String(answer).slice(0, MAX),
  };

  // Always logged, so it's recoverable from the platform logs even with no webhook.
  console.log("SUFRA_FEEDBACK " + JSON.stringify(report));

  const hook = process.env.FEEDBACK_WEBHOOK_URL;
  if (hook) {
    const summary = [
      `Unhelpful answer reported by ${report.user}`,
      `Reason: ${report.reason}${report.detail ? ` — ${report.detail}` : ""}`,
      `Language: ${report.lang || "unknown"}`,
      "",
      `Q: ${report.question}`,
      `A: ${report.answer}`,
    ].join("\n");

    try {
      await fetch(hook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `text` satisfies Slack and Discord; the full object is there for
        // anything else reading the body directly.
        body: JSON.stringify({ text: summary, content: summary, ...report }),
      });
    } catch (err) {
      // A failed webhook must not lose the report — it's already in the logs.
      console.error("Feedback webhook failed:", err.message);
    }
  }

  return res.status(200).json({ ok: true });
}
