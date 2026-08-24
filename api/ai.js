/* AI photo analysis — one endpoint, two jobs.

   POST { kind: "bill" | "inventory", image: <data URL>, lang, note? }

   "bill":      a photo of a printed bill/receipt. Claude reads the line
                items, matches them to the menu (with the owner's entered
                costs), and returns cost and profit per line and in total.
                Anything it can't match is flagged so the cashier can pick
                the menu item by hand.
   "inventory": a photo of a shelf, delivery, or stock. Claude identifies
                the items and estimates quantities as a starting point for
                a count.

   The model only ever sees the photo plus the menu list — never another
   account's data. Requires the `billscan` package for bills; inventory
   analysis rides the `operations` package. */

import { requireAuth } from "./_auth.js";
import { getAccount, posTokenFor } from "./_accounts.js";
import { effectivePlanFor } from "./_org.js";
import { getMetrics } from "./_data.js";
import { getJSON } from "./_store.js";

const MODEL = "claude-sonnet-4-5";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function parseDataUrl(url) {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(String(url || ""));
  if (!m) return null;
  if (Buffer.byteLength(m[2], "base64") > MAX_IMAGE_BYTES) return null;
  return { mediaType: m[1], data: m[2] };
}

function extractJSON(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

const LANG_NOTE = {
  ar: "Write every `note` and `summary` field in Arabic.",
  hi: "Write every `note` and `summary` field in Hindi.",
  tl: "Write every `note` and `summary` field in Filipino.",
  en: "Write every `note` and `summary` field in English.",
};

function billPrompt(menu, langNote) {
  return `You read photos of restaurant bills/receipts.

MENU (name | selling price | unit cost; cost 0 means unknown):
${menu.map((i) => `${i.name} | ${i.price} | ${i.cost}`).join("\n") || "(no menu data available)"}

From the photo, extract every line item. Match each to the closest MENU item (fuzzy match is fine — abbreviations, misspellings, other language). For matched items compute cost = qty × unit cost and profit = amount − cost (null when unit cost is 0/unknown).

Respond with ONLY this JSON, nothing else:
{
  "lines": [{ "text": "<line as printed>", "qty": <n>, "amount": <total for line>, "menuItem": "<matched menu name or null>", "cost": <n or null>, "profit": <n or null> }],
  "total": <bill total>,
  "totalCost": <sum of known costs or null>,
  "totalProfit": <total minus totalCost or null>,
  "unmatched": ["<line text with no menu match>"],
  "summary": "<one sentence: what this bill earned>"
}
${langNote}`;
}

function inventoryPrompt(langNote) {
  return `You read photos of restaurant stock — shelves, fridges, deliveries, crates.

Identify every distinct item you can see and estimate its quantity honestly. Say what you can't tell.

Respond with ONLY this JSON, nothing else:
{
  "items": [{ "name": "<item>", "qty": <estimated number or null>, "unit": "<pcs|kg|bottle|box|...>", "note": "<what the estimate rests on, or what's unclear>" }],
  "summary": "<one or two sentences describing what the photo shows>"
}
${langNote}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const session = await requireAuth(req, res);
  if (!session) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "noai" });

  const { kind, image, lang } = req.body || {};
  const img = parseDataUrl(image);
  if (!img) return res.status(400).json({ error: "image" });
  if (!["bill", "inventory"].includes(kind)) return res.status(400).json({ error: "kind" });

  try {
    const account = await getAccount(session.username);
    const plan = await effectivePlanFor(account);
    const active = plan.items?.length && !(plan.until && plan.until < Date.now());
    const items = active ? plan.items : [];
    const needed = kind === "bill" ? "billscan" : "operations";
    if (!items.includes(needed)) {
      return res.status(402).json({ error: "locked", feature: needed });
    }

    const langNote = LANG_NOTE[lang] || LANG_NOTE.en;
    let prompt;
    if (kind === "bill") {
      /* The menu with the owner's costs, so profit is computable. */
      let menu = [];
      try {
        const overrides = (await getJSON(`costs:${session.username}`)) || {};
        const metrics = await getMetrics(await posTokenFor(session.username), { overrides });
        menu = (metrics.items || []).map((i) => ({
          name: i.name,
          price: i.qty > 0 ? Math.round((i.revenue / i.qty) * 100) / 100 : 0,
          cost: overrides[i.name] || i.cost || 0,
        }));
      } catch {
        /* No POS — the scan still reads the bill, just without matching. */
      }
      prompt = billPrompt(menu, langNote);
    } else {
      prompt = inventoryPrompt(langNote);
    }

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } },
            { type: "text", text: prompt },
          ],
        }],
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      console.error("ai analysis failed:", upstream.status, detail.slice(0, 300));
      return res.status(502).json({ error: "ai" });
    }

    const data = await upstream.json();
    const text = (data.content || []).map((b) => b.text || "").join("");
    const parsed = extractJSON(text);
    if (!parsed) return res.status(502).json({ error: "parse" });

    return res.status(200).json({ kind, result: parsed });
  } catch (err) {
    console.error("ai endpoint failed:", err);
    return res.status(500).json({ error: "server" });
  }
}
