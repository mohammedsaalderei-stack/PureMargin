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
import { orgFor, membership, can, scopeFor } from "./_org.js";
import { depletionFor } from "./_depletion.js";
import { claimScan, refundScan, scanUsage } from "./_scanquota.js";
import { matchPurchase } from "./_purchase.js";
import { listIngredients } from "./_inventory.js";
import { matchRecipe } from "./_recipescan.js";
import { classifyPrompt, normaliseVerdict, routeFor } from "./_docroute.js";

/* Overridable without a deploy, so a model rename doesn't take the scanner
   down until somebody ships a commit. */
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/* What can be scanned.

   Photographs were the only accepted input, which assumed every bill and every
   delivery note starts life on paper. Plenty do not: suppliers email a PDF
   invoice, a POS exports a PDF sales report, and a recipe often lives in a
   document somebody typed years ago. Telling that person to print it and
   photograph it is asking them to degrade a perfect copy to use the feature.

   PDFs go to the model as documents rather than images, which is both cheaper
   and more accurate — the text layer is read directly instead of being
   recognised out of pixels, so a multi-page invoice arrives intact rather than
   as one photograph of its first page. */
const IMAGE_TYPES = /^image\/(?:jpeg|png|webp|gif)$/;
const PDF_TYPE = "application/pdf";

export function parseDataUrl(url) {
  const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i.exec(String(url || ""));
  if (!m) return null;

  const mediaType = m[1].toLowerCase();
  const data = m[2];
  if (Buffer.byteLength(data, "base64") > MAX_IMAGE_BYTES) return null;

  if (IMAGE_TYPES.test(mediaType)) return { kind: "image", mediaType, data };
  if (mediaType === PDF_TYPE) return { kind: "document", mediaType, data };
  return null;
}

/* The content block this file becomes in the request. A document and an image
   are different block types to the API, and sending a PDF as an image is
   rejected outright rather than degraded. */
export function contentBlock(file) {
  return file.kind === "document"
    ? { type: "document", source: { type: "base64", media_type: file.mediaType, data: file.data } }
    : { type: "image", source: { type: "base64", media_type: file.mediaType, data: file.data } };
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

MENU (one name per line):
${menu.map((i) => i.name).join("\n") || "(no menu data available)"}

From the photo, transcribe every line item exactly as printed. Match each to
the closest MENU name (fuzzy matching is fine — abbreviations, misspellings,
another language). Use null when nothing on the menu is a plausible match.

Report only what you can SEE on the paper. Do not calculate costs, profit, or
any figure that is not printed on the bill, and do not estimate a number you
cannot read — use null instead. Guessing here is worse than admitting the line
is unreadable, because a plausible wrong number gets trusted.

Respond with ONLY this JSON, nothing else:
{
  "lines": [{ "text": "<line as printed>", "qty": <number printed, or null>, "amount": <line total printed, or null>, "menuItem": "<matched menu name, or null>" }],
  "total": <bill total as printed, or null>,
  "summary": "<one sentence describing this bill>"
}
${langNote}`;
}

/* Cost and profit are computed here, from the owner's own cost table, and
   never asked of the model.

   Before this, the prompt handed Claude the unit costs and asked it to
   multiply and subtract. Language models are unreliable arithmetic engines:
   the same bill scanned twice produced different totals, and a cost the model
   half-remembered from the menu list looked exactly as authoritative as one
   the owner had actually entered. Reading a photo is the part that needs a
   model. Multiplication is not.

   A line only gets a cost when it matched a menu item that has a real cost
   recorded. Everything else stays null and surfaces to the cashier as
   unmatched, which is the honest answer. */
export function priceBill(parsed, menu) {
  const costs = new Map(menu.map((i) => [i.name, Number(i.cost) || 0]));
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

  const lines = (Array.isArray(parsed.lines) ? parsed.lines : []).map((line) => {
    const qty = num(line.qty);
    const amount = num(line.amount);
    const name = typeof line.menuItem === "string" && costs.has(line.menuItem)
      ? line.menuItem
      : null;
    const unit = name ? costs.get(name) : 0;
    const cost = name && unit > 0 && qty !== null
      ? Math.round(unit * qty * 100) / 100
      : null;
    const profit = cost !== null && amount !== null
      ? Math.round((amount - cost) * 100) / 100
      : null;
    return { text: String(line.text || ""), qty, amount, menuItem: name, cost, profit };
  });

  const sum = (pick) => lines.reduce((acc, l) => {
    const v = pick(l);
    return acc === null || v === null ? null : acc + v;
  }, 0);

  const totalAmount = num(parsed.total);
  /* A total is only reported when every line contributed one. A partial sum
     presented as "total cost" reads as complete and is quietly wrong. */
  const totalCost = lines.length ? sum((l) => l.cost) : null;
  const totalProfit = totalCost !== null && totalAmount !== null
    ? Math.round((totalAmount - totalCost) * 100) / 100
    : null;

  return {
    lines,
    total: totalAmount,
    totalCost: totalCost === null ? null : Math.round(totalCost * 100) / 100,
    totalProfit,
    unmatched: lines.filter((l) => !l.menuItem).map((l) => l.text),
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
  };
}

function supplierPrompt(langNote, stock = []) {
  return `You read photos of supplier invoices and delivery notes for a
restaurant, and of grocery receipts where a restaurant has bought supplies.

INGREDIENTS ALREADY ON FILE (one name per line):
${stock.map((i) => i.name).join("\n") || "(none on file yet)"}

Transcribe every purchased line exactly as printed, and match each to the
closest name on that list. Abbreviations, misspellings, another language and a
supplier's packaging words are all fine to see through: "TOMATO RED 5KG BOX" is
the tomatoes on the list. Use null when nothing on the list is a plausible
match — a wrong match writes a delivery against the wrong shelf, and nothing
downstream will contradict it.

Only ever answer with a name copied exactly from that list, or null. Do not
invent a name, and do not adjust the spelling of one you found.

Do not convert units and do not calculate a unit price — those are worked out
afterwards from the business's own records, and a guess would be written into a
stock balance as though it were measured.

If a quantity, a unit or an amount cannot be read, use null. A null is a
question somebody answers in two seconds; a wrong number is a discrepancy
somebody hunts for next month.

Respond with ONLY this JSON, nothing else:
{
  "supplier": "<supplier or shop name, or null>",
  "invoiceNo": "<invoice or receipt number, or null>",
  "date": "<date as printed, or null>",
  "lines": [{ "text": "<line as printed>", "qty": <number, or null>, "unit": "<kg, g, l, ml, box, pcs… as printed, or null>", "amount": <line total, or null>, "ingredient": "<exact name from the list, or null>" }],
  "total": <invoice total as printed, or null>
}
${langNote}`;
}

function recipePrompt(langNote, stock = []) {
  return `You read photographs of recipe cards, handwritten recipes and printed
recipe sheets from restaurant kitchens.

INGREDIENTS ALREADY ON FILE (one name per line):
${stock.map((i) => i.name).join("\n") || "(none on file yet)"}

Transcribe the dish name, how many portions it says it makes, and every
ingredient quantity written on it. Copy the quantities exactly as written —
"1/2", "1½" and "0.5" are all fine, and so is a quantity with no unit. Match
each line to the closest name on that list, copied exactly, or null when
nothing on it is a plausible match.

Report only what is on the card. Do not convert between units, and do not
invent a portion count the card does not state — those are settled afterwards against the business's own
records, and a guess here would be written into a recipe that every cost report
afterwards is built on.

Ignore the method and the cooking steps. Only the ingredient list matters.

Respond with ONLY this JSON, nothing else:
{
  "menuItem": "<dish name, or null>",
  "portions": <number of portions the card states, or null>,
  "note": "<anything short worth keeping, or null>",
  "lines": [{ "text": "<ingredient as written>", "qty": "<quantity as written, or null>", "unit": "<g, kg, ml, l, tsp, tbsp, cup, pcs… as written, or null>", "ingredient": "<exact name from the list, or null>" }]
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
  const session = await requireAuth(req, res);
  if (!session) return;

  /* Reading the allowance must not consume one, so it is its own method. The
     scanner asks on open, which is how somebody sees "12 left this month"
     before taking the photo rather than after. */
  if (req.method === "GET") {
    const account = await getAccount(session.username);
    const org = account ? await orgFor(account) : null;
    return res.status(200).json({
      scans: await scanUsage(org?.id || `solo:${session.username}`),
    });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Use GET or POST." });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "noai" });

  const { kind, image, lang } = req.body || {};
  const file = parseDataUrl(image);
  if (!file) return res.status(400).json({ error: "image" });
  if (!["bill", "inventory", "supplier", "recipe", "classify", "auto"].includes(kind)) return res.status(400).json({ error: "kind" });

  try {
    const account = await getAccount(session.username);
    const plan = await effectivePlanFor(account);
    const active = plan.items?.length && !(plan.until && plan.until < Date.now());
    const items = active ? plan.items : [];
    const needed = kind === "bill" ? "billscan" : "operations";
    if (!items.includes(needed)) {
      return res.status(402).json({ error: "locked", feature: needed });
    }

    /* The allowance is claimed before the model is called. Counting afterwards
       would let a burst of parallel requests all pass the check, and would hand
       out free scans exactly when something is retrying hardest. */
    const org = await orgFor(account);
    const claim = await claimScan(org?.id || `solo:${account.username}`);
    if (!claim.allowed) {
      return res.status(429).json({
        error: "quota", used: claim.used, limit: claim.limit, resetsAt: claim.resetsAt,
      });
    }
    const spend = org?.id || `solo:${account.username}`;

    const langNote = LANG_NOTE[lang] || LANG_NOTE.en;
    let prompt;
    let menuForPricing = [];
    /* Loaded for `auto` as well, because auto may turn out to be a bill and
       the menu has to be in hand before the second call rather than fetched
       after the model has already answered. */
    if (kind === "bill" || kind === "auto") {
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
      menuForPricing = menu;
      if (kind === "bill") prompt = billPrompt(menu, langNote);
    }
    /* The scanners that match against stock need the list in hand before the
       call, the same way the bill scanner needs the menu. The model picks a
       name from it; the server then checks that name is really on the list, so
       an invented one is discarded rather than trusted. */
    let stockForMatching = [];
    if (kind === "supplier" || kind === "recipe" || kind === "auto") {
      try {
        stockForMatching = org?.id ? await listIngredients(org.id) : [];
      } catch { /* the scan still works, it just matches nothing */ }
    }

    if (kind === "supplier") prompt = supplierPrompt(langNote, stockForMatching);
    else if (kind === "recipe") prompt = recipePrompt(langNote, stockForMatching);
    else if (kind === "classify") prompt = classifyPrompt(langNote);
    else if (kind === "inventory") prompt = inventoryPrompt(langNote);

    /* One request to the model, so the two-stage `auto` path below can ask
       twice without a second copy of the request shape drifting from this one. */
    async function askModel(text) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 2000,
          temperature: 0,
          messages: [{ role: "user", content: [contentBlock(file), { type: "text", text }] }],
        }),
      });
      if (!res.ok) {
        console.error("AI call failed:", res.status, (await res.text().catch(() => "")).slice(0, 300));
        return null;
      }
      const body = await res.json();
      return extractJSON((body.content || []).map((c) => c.text || "").join("\n"));
    }

    /* Drop a document in and have it land where it belongs.

       Somebody holding a PDF does not think in tabs. Two calls: one to decide
       what the document is, one to read it with the prompt that suits it. Both
       against the same file, and it costs one scan rather than two — it is one
       document, and charging twice for the app's own filing step would be a
       tax on the convenience.

       If the sorting step cannot place it, the reading step is skipped
       entirely rather than guessed at with a default prompt. A delivery note
       read as a customer bill produces a confident page of wrong numbers. */
    if (kind === "auto") {
      const sorted = await askModel(classifyPrompt(langNote));
      if (!sorted) { await refundScan(spend); return res.status(502).json({ error: "ai" }); }

      const verdict = normaliseVerdict(sorted);
      const scope = account ? await scopeFor(account, []) : null;
      const route = routeFor(verdict.kind, scope?.capabilities || []);

      if (verdict.kind === "unknown" || !route.allowed) {
        return res.status(200).json({
          kind: "auto",
          result: { ...verdict, route, extracted: null },
          scans: { used: claim.used, limit: claim.limit, left: claim.left, resetsAt: claim.resetsAt },
        });
      }

      const prompts = {
        supplier: (note) => supplierPrompt(note, stockForMatching),
        recipe: (note) => recipePrompt(note, stockForMatching),
        bill: (note) => billPrompt(menuForPricing, note),
        inventory: inventoryPrompt,
      };
      const raw = await askModel(prompts[verdict.kind](langNote));
      if (!raw) { await refundScan(spend); return res.status(502).json({ error: "parse" }); }

      let extracted = raw;
      if (verdict.kind === "bill") extracted = priceBill(raw, menuForPricing);
      else if (verdict.kind === "supplier") extracted = await matchPurchase(org?.id, raw);
      else if (verdict.kind === "recipe") extracted = await matchRecipe(org?.id, raw);

      return res.status(200).json({
        kind: "auto",
        result: { ...verdict, route, extracted },
        scans: { used: claim.used, limit: claim.limit, left: claim.left, resetsAt: claim.resetsAt },
      });
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
        /* Reading a bill has one right answer. At the default temperature the
           same photo produced different numbers on consecutive scans, which is
           indistinguishable from the feature being broken. */
        temperature: 0,
        messages: [{
          role: "user",
          content: [
            contentBlock(file),
            { type: "text", text: prompt },
          ],
        }],
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      console.error("ai analysis failed:", upstream.status, detail.slice(0, 300));
      /* The model never answered, so the person got nothing. Charging them a
         scan for our own outage would be a quiet tax on it. */
      await refundScan(spend);
      return res.status(502).json({ error: "ai" });
    }

    const data = await upstream.json();
    const text = (data.content || []).map((b) => b.text || "").join("");
    const parsed = extractJSON(text);
    if (!parsed) {
      await refundScan(spend);
      return res.status(502).json({ error: "parse" });
    }

    let result = parsed;
    if (kind === "bill") result = priceBill(parsed, menuForPricing);
    else if (kind === "supplier") result = await matchPurchase(org?.id, parsed);
    else if (kind === "recipe") result = await matchRecipe(org?.id, parsed);
    else if (kind === "classify") {
      /* Sorting a document is one model call and no data, so it costs a scan
         like any other read. Routing is decided here from a fixed table rather
         than asked of the model, and the caller's own capabilities decide
         whether the destination is open to them. */
      const verdict = normaliseVerdict(parsed);
      const scope = account ? await scopeFor(account, []) : null;
      result = { ...verdict, route: routeFor(verdict.kind, scope?.capabilities || []) };
    }

    /* What this bill took out of the store, offered rather than applied.

       Only to somebody who could commit it anyway: proposing movements to a
       cashier would show them a button they cannot press, and the count
       workflow deliberately separates recording from approving. Failure here
       is silent — the scan itself worked, and losing the pricing because a
       recipe lookup threw would be a poor trade. */
    let depletion = null;
    if (kind === "bill" && result.lines?.length) {
      try {
        const org = await orgFor(account);
        const me = org ? membership(org, account.username) : null;
        if (me && can(me.role, "manage:inventory")) {
          depletion = await depletionFor(org.id, result.lines);
        }
      } catch (err) {
        console.error("depletion plan failed:", err);
      }
    }

    return res.status(200).json({
      kind, result, depletion,
      scans: { used: claim.used, limit: claim.limit, left: claim.left, resetsAt: claim.resetsAt },
    });
  } catch (err) {
    console.error("ai endpoint failed:", err);
    return res.status(500).json({ error: "server" });
  }
}
