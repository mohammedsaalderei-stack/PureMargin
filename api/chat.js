import { requireAuth } from "./_auth.js";
import { getMetrics, toContext, branchList, salesLines } from "./_data.js";
import { redactContext, redactionNote } from "./_askscope.js";
import { posTokenFor, noteQuestion, getAccount, activeItems } from "./_accounts.js";
import { getJSON } from "./_store.js";
import { groundingFor, ANSWER_CONTRACT } from "./_grounding.js";
import { parseBranchParam, scopeFor } from "./_org.js";
import { listEdits } from "./_saleedits.js";

const MODEL = "claude-sonnet-4-5";

const LANG_NOTE = {
  ar: "The interface is in Arabic. Answer in Arabic unless the user writes to you in English. Use plain Gulf business Arabic, not formal literary phrasing. Keep numerals in Western digits, the way receipts and invoices are written here.",
  hi: "The interface is in Hindi. Answer in Hindi unless the user writes to you in another language. Use everyday business Hindi — the way a restaurant owner actually speaks — not Sanskritised formal register. Keep numerals in Western digits.",
  tl: "The interface is in Filipino. Answer in Filipino unless the user writes to you in another language. Natural conversational Taglish is fine and normal for business talk in Manila — don't force deep Tagalog for terms people say in English, like 'sales', 'branch', or 'order'.",
  en: "Answer in the language the user writes in.",
};

/* Stage 6: the operational brief is assembled by `_grounding.js`, which is the
   only path by which inventory, cost and forecast figures reach the model — and
   which contains nothing outside the user's authorized branches. The prompt is the
   boundary: a scope it never receives cannot be talked about. */
function buildSystem(metrics, lang, grounding, capabilities) {
  return `You are PureMargin, an analyst for a food business in the UAE — restaurants, cafés, and cloud kitchens.

How to answer:
- ${LANG_NOTE[lang] || LANG_NOTE.en}
- Lead with the number, then the reason. Two or three short paragraphs at most.
- Round sensibly. Nobody needs fils.
- When something looks worth acting on, say so plainly, but the decision stays theirs.
- Use ONLY the figures below. If the answer isn't in them, say what's missing and what would need connecting. Never estimate a number that isn't there.

${toContext(redactContext(metrics, capabilities))}${redactionNote(capabilities)}${grounding ? `

${ANSWER_CONTRACT}

=== OPERATIONS BRIEF (inventory, recipes, costing — permission-scoped) ===
${grounding.brief}` : ""}`;
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

  const { messages, lang, stream = true, branches: requestedBranches } = req.body || {};
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
    if (account) {
      /* The effective plan — a team member inherits the owner's packages. */
      const { effectivePlanFor } = await import("./_org.js");
      const plan = await effectivePlanFor(account);
      const active = plan.items?.length && !(plan.until && plan.until < Date.now());
      if (!(active ? plan.items : []).includes("assistant")) {
        return res.status(402).json({ error: "locked", feature: "assistant" });
      }
    }

    /* The asker's own capabilities, so the context can be cut to them before
       the model sees it. Read from the same place every data route reads it,
       so the assistant cannot end up with a more generous view than the
       screens. */
    const askerScope = await scopeFor(session.account, []).catch(() => null);
    const capabilities = askerScope?.capabilities || [];

    const overrides = (await getJSON(`costs:${session.username}`)) || {};
    const posToken = await posTokenFor(session.username);
    /* The same corrections the screens read. An assistant quoting the till's
       uncorrected total while the dashboard shows the corrected one is worse
       than an assistant with no figures at all: two authoritative answers that
       disagree, with nothing on screen to explain which is which. */
    const saleEdits = await listEdits(askerScope?.org?.id).catch(() => ({}));
    const metrics = await getMetrics(posToken, { overrides, edits: saleEdits });

    /* The operations half of the answer. It is best-effort: an account with no
       organization, or a POS that won't answer, still gets the sales assistant it
       had before — it just has no inventory or costing figures to reason from. */
    let grounding = null;
    try {
      const roster = await branchList(posToken).catch(() => []);
      const to = Date.now();
      const from = to - 30 * 864e5;
      const sales = await salesLines(posToken, { from, to, edits: saleEdits }).catch(() => ({ lines: [], fetch: null }));
      grounding = await groundingFor(session.account, {
        allBranchIds: roster.map((b) => b.id),
        branchNames: Object.fromEntries(roster.map((b) => [b.id, b.name])),
        salesRows: sales.lines,
        salesFetchedAt: sales.fetch?.at || null,
        /* The scope the user asked their question in. Never trusted: the
           grounding intersects it with this session's authorization, so naming a
           branch in the request body cannot widen what the assistant is told. */
        requested: parseBranchParam(requestedBranches),
        from, to,
      });
    } catch (err) {
      console.error("grounding failed, answering from sales only:", err);
    }

    noteQuestion(session.username).catch(() => {});
    const payload = {
      model: MODEL,
      max_tokens: 1200,
      system: buildSystem(metrics, lang, grounding, capabilities),
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
