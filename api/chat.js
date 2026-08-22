import { requireAuth } from "./_auth.js";
import { getMetrics, toContext } from "./_data.js";
import { posTokenFor, noteQuestion, getAccount, activeItems } from "./_accounts.js";
import { getJSON } from "./_store.js";

const MODEL = "claude-sonnet-4-5";

const LANG_NOTE = {
  ar: "The interface is in Arabic. Answer in Arabic unless the user writes to you in English. Use plain Gulf business Arabic, not formal literary phrasing. Keep numerals in Western digits, the way receipts and invoices are written here.",
  hi: "The interface is in Hindi. Answer in Hindi unless the user writes to you in another language. Use everyday business Hindi — the way a restaurant owner actually speaks — not Sanskritised formal register. Keep numerals in Western digits.",
  tl: "The interface is in Filipino. Answer in Filipino unless the user writes to you in another language. Natural conversational Taglish is fine and normal for business talk in Manila — don't force deep Tagalog for terms people say in English, like 'sales', 'branch', or 'order'.",
  en: "Answer in the language the user writes in.",
};

function buildSystem(metrics, lang) {
  return `You are Sufra, an analyst for a food business in the UAE — restaurants, cafés, and cloud kitchens.

How to answer:
- ${LANG_NOTE[lang] || LANG_NOTE.en}
- Lead with the number, then the reason. Two or three short paragraphs at most.
- Round sensibly. Nobody needs fils.
- When something looks worth acting on, say so plainly, but the decision stays theirs.
- Use ONLY the figures below. If the answer isn't in them, say what's missing and what would need connecting. Never estimate a number that isn't there.

${toContext(metrics)}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST." });
  }
  const session = await requireAuth(req, res);
  if (!session) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "The assistant isn't configured yet. Add ANTHROPIC_API_KEY to the server environment.",
    });
  }

  const { messages, lang, stream = true } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "No question was received." });
  }

  const clean = messages
    .filter((m) => m && m.content && !m.failed)
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content),
    }));

  try {
    const account = await getAccount(session.username);
    if (account && !activeItems(account).includes("assistant")) {
      return res.status(402).json({ error: "locked", feature: "assistant" });
    }

    const overrides = (await getJSON(`costs:${session.username}`)) || {};
    const metrics = await getMetrics(await posTokenFor(session.username), { overrides });
    noteQuestion(session.username).catch(() => {});
    const payload = {
      model: MODEL,
      max_tokens: 1200,
      system: buildSystem(metrics, lang),
      messages: clean,
      stream: Boolean(stream),
    };

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });

    if (!upstream.ok) {
      const detail = await upstream.json().catch(() => ({}));
      console.error("Anthropic error:", detail);
      return res.status(upstream.status).json({
        error: detail?.error?.message || "The assistant couldn't answer that.",
      });
    }

    /* Non-streaming path — fallback, and for clients that ask for it. */
    if (!stream) {
      const data = await upstream.json();
      const text = (data.content || [])
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("")
        .trim();
      return res.status(200).json({ text: text || "No answer came back. Try rephrasing." });
    }

    /* Streaming path — forward text deltas as they arrive, so the answer
       appears while it's being written rather than all at once. */
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === "[DONE]") continue;

        try {
          const event = JSON.parse(raw);
          if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
            res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
          } else if (event.type === "error") {
            res.write(`data: ${JSON.stringify({ error: event.error?.message || "Stream failed." })}\n\n`);
          }
        } catch {
          /* Partial JSON chunk — the next read completes it. */
        }
      }
    }

    res.write("data: [DONE]\n\n");
    return res.end();
  } catch (err) {
    if (err?.code === "notconnected") {
      return res.status(409).json({ error: "notconnected" });
    }
    if (err?.code === "pos") {
      return res.status(502).json({ error: "pos", detail: err.detail });
    }
    console.error("chat failed:", err);
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: "The connection dropped mid-answer." })}\n\n`);
      return res.end();
    }
    return res.status(500).json({ error: "Couldn't reach the assistant. Try again." });
  }
}
