import { requireAuth } from "./_auth.js";
import { getMetrics, toContext, branchList, salesLines } from "./_data.js";
import { redactContext, redactionNote } from "./_askscope.js";
import { posTokenFor, noteQuestion, getAccount, activeItems } from "./_accounts.js";
import { getJSON } from "./_store.js";
import { groundingFor, ANSWER_CONTRACT } from "./_grounding.js";
import { parseBranchParam, effectiveBranches, scopeFor } from "./_org.js";
import { listEdits } from "./_saleedits.js";
import { TOOLS, runTool, DOMAIN_GUARDRAIL } from "./_domains.js";

const MODEL = "claude-sonnet-4-5";

/* The wire format between this route and the Ask screen.

   This endpoint does not proxy Anthropic's events through. It re-frames them
   into one shape — `{ text }` for a chunk of answer, `{ error }` for a
   failure — and `src/screens/Ask.jsx` accumulates `evt.text` and throws on
   `evt.error`, ignoring anything else.

   "Ignoring anything else" is the part that makes a helper worth having. A
   frame in the wrong shape is not an error anywhere: the server writes it, the
   stream completes, the client accumulates nothing, and the question comes
   back blank with no failure recorded on either side. That happened — the tool
   loop below was written to emit Anthropic's `content_block_delta` envelope,
   which has no top-level `text`, and every question that used a tool returned
   an empty answer that had actually been generated correctly.

   So there is one function that knows the shape, and every writer goes through
   it. */
export const sseText = (text) => `data: ${JSON.stringify({ text })}\n\n`;
export const sseError = (message) => `data: ${JSON.stringify({ error: message })}\n\n`;
export const SSE_DONE = "data: [DONE]\n\n";

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

${DOMAIN_GUARDRAIL}

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
    /* Everything a scoped tool is allowed to reach, and nothing else.

       The org, the branch list already intersected with this session's
       authorization, and the capabilities each tool checks for itself. A tool
       is never handed the session or the request body, so there is no argument
       it can be called with that widens what it can see. */
    const toolCtx = {
      orgId: askerScope?.org?.id || null,
      branches: effectiveBranches(parseBranchParam(requestedBranches), askerScope?.authorized || []),
      capabilities,
      method: "wavg",
      metrics,
    };

    const payload = {
      model: MODEL,
      max_tokens: 1200,
      system: buildSystem(metrics, lang, grounding, capabilities),
      messages: clean,
      /* No organization means no domains to read, so no tools are offered
         rather than five that would all refuse. */
      ...(toolCtx.orgId ? { tools: TOOLS } : {}),
      stream: Boolean(stream),
    };

    /* ── The tool loop ──────────────────────────────────────────────────

       Streaming and tool use do not compose simply: a stream that stops to
       call a function has to be drained, answered and restarted, and text
       already sent must not be sent twice. So a turn that uses tools runs
       unstreamed, resolves every call, and sends the finished answer. The
       tools are local reads against the same store the screens use, so the
       pause is milliseconds rather than a round trip to anywhere.

       Bounded, because a model that keeps asking for the same tool would
       otherwise loop until the request times out. Four is more than any real
       question needs: the deepest is "what is my profit, and why", which is
       one calculate_net_profit and one get_recipe_details. */
    const MAX_TOOL_TURNS = 4;

    if (toolCtx.orgId) {
      const turn = { ...payload, stream: false };

      for (let i = 0; i < MAX_TOOL_TURNS; i++) {
        const round = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify(turn),
        });

        /* An upstream failure here falls through to the ordinary path below,
           which reports it properly rather than swallowing it. */
        if (!round.ok) break;

        const data = await round.json();
        const calls = (data.content || []).filter((c) => c.type === "tool_use");

        if (!calls.length) {
          const text = (data.content || [])
            .map((c) => (c.type === "text" ? c.text : ""))
            .join("")
            .trim();
          if (!text) break;

          if (!stream) return res.status(200).json({ text });

          /* Delivered as one frame, in this route's own shape.

             That shape matters and is easy to get wrong: this endpoint does
             not proxy Anthropic's events through: it re-frames them as
             `{ text }`, and the client accumulates `evt.text` and ignores
             anything else. Writing the upstream `content_block_delta` envelope
             here produced a frame with no top-level `text`, so the reader
             accumulated nothing and every tool-using question came back blank
             — a working answer, discarded one layer from the screen. */
          res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
          res.setHeader("Cache-Control", "no-cache, no-transform");
          res.setHeader("Connection", "keep-alive");
          res.setHeader("X-Accel-Buffering", "no");
          res.write(sseText(text));
          res.write(SSE_DONE);
          return res.end();
        }

        const results = [];
        for (const call of calls) {
          let out;
          try {
            out = await runTool(call.name, call.input, toolCtx);
          } catch (err) {
            /* One failing lookup must not take the answer down. The model is
               told this call failed and can say so or work without it. */
            console.error("tool failed:", call.name, err?.message || err);
            out = { error: "tool_failed", message: "That lookup could not be completed." };
          }
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: JSON.stringify(out),
          });
        }

        turn.messages = [
          ...turn.messages,
          { role: "assistant", content: data.content },
          { role: "user", content: results },
        ];
      }

      /* Everything below this point is the fallback, and it must not offer
         tools.

         The streaming forwarder understands text deltas and nothing else, so a
         model that answered with a tool call there would produce no text at
         all and the question would come back blank — which is exactly the
         failure the loop above exists to avoid. Reaching here means the loop
         could not finish: upstream refused, the answer was empty, or four
         turns went by. In every one of those cases the right next move is to
         ask for prose. */
      delete payload.tools;
    }

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
            res.write(sseText(event.delta.text));
          } else if (event.type === "error") {
            res.write(sseError(event.error?.message || "Stream failed."));
          }
        } catch {
          /* Partial JSON chunk — the next read completes it. */
        }
      }
    }

    res.write(SSE_DONE);
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
      res.write(sseError("The connection dropped mid-answer."));
      return res.end();
    }
    return res.status(500).json({ error: "Couldn't reach the assistant. Try again." });
  }
}
