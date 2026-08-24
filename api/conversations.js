import { requireAuth } from "./_auth.js";
import { getJSON, setJSON, persistent } from "./_store.js";

/* Conversations, stored against the account rather than the browser.
   Threads now follow the person between their phone and the office laptop,
   which localStorage could never do.

   Held as one list per user. That's the right shape while a café has tens
   of threads; if someone accumulates thousands, this wants splitting into
   one key per thread with an index. LIMIT keeps that day far off. */

const KEY = (username) => `chats:${username}`;
const LIMIT = 100;
const MAX_MESSAGES = 200;

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  const key = KEY(session.username);

  try {
    if (req.method === "GET") {
      const list = (await getJSON(key)) || [];
      return res.status(200).json({ conversations: list, persistent });
    }

    if (req.method === "PUT") {
      const { id, title, messages } = req.body || {};
      if (!id || !Array.isArray(messages) || !messages.length) {
        return res.status(400).json({ error: "payload" });
      }

      const list = (await getJSON(key)) || [];
      const now = Date.now();
      const trimmed = messages.slice(-MAX_MESSAGES).map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content ?? "").slice(0, 8000),
      }));

      const existing = list.find((c) => c.id === id);
      if (existing) {
        existing.messages = trimmed;
        existing.title = existing.title || title || "";
        existing.updatedAt = now;
      } else {
        list.unshift({ id, title: title || "", messages: trimmed, createdAt: now, updatedAt: now });
      }

      list.sort((a, b) => b.updatedAt - a.updatedAt);
      await setJSON(key, list.slice(0, LIMIT));
      return res.status(200).json({ ok: true });
    }

    if (req.method === "DELETE") {
      const { id } = req.body || {};
      const list = (await getJSON(key)) || [];
      await setJSON(key, id ? list.filter((c) => c.id !== id) : []);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Use GET, PUT or DELETE." });
  } catch (err) {
    console.error("conversations failed:", err);
    return res.status(500).json({ error: "server" });
  }
}
