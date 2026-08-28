/* A document dropped into Ask, and where its contents belong.

   Somebody with a PDF does not think in terms of which tab it belongs to. They
   have a supplier invoice, a stock take a manager typed into Excel, a recipe
   the head chef wrote in Word, or a sales report the till exported — and they
   want the app to take it. Making them first decide "is this an inventory
   document or a cost document" is asking them to know the software's filing
   system before it will accept their paperwork.

   So the document is read once and sorted here. Which is a classification
   problem, and classification is exactly where a confident wrong answer does
   the most damage: a delivery note filed as a stock count writes receipts as
   adjustments, and the ledger then disagrees with the invoice for reasons
   nobody can trace.

   Three rules keep that from happening.

   The model is asked what the document *is*, not what to do with it. Mapping a
   kind to a destination is a fixed table below, not a judgement it makes each
   time.

   Nothing is written. Every route ends at a screen that already exists and
   already asks for confirmation — the supplier scanner, the recipe scanner,
   the count sheet. The document becomes a filled-in form, never a committed
   record.

   A document it cannot place is reported as unplaced rather than pushed into
   the nearest match. "I don't know what this is" is a useful answer; a
   purchase order filed as a recipe is not. */

export const KINDS = {
  supplier: {
    /* A delivery note, a supplier invoice, a grocery receipt. */
    tab: "inventory",
    scanner: "supplier",
    needs: "manage:inventory",
  },
  recipe: {
    /* A recipe card, a spec sheet, a prep list with quantities. */
    tab: "recipes",
    scanner: "recipe",
    needs: "manage:recipes",
  },
  bill: {
    /* A customer bill or a sales receipt from the till. */
    tab: "costs",
    scanner: "bill",
    needs: "view:dashboard",
  },
  inventory: {
    /* A stock take, a shelf count, an opening balance sheet. */
    tab: "inventory",
    scanner: "inventory",
    needs: "manage:inventory",
  },
};

export const KIND_KEYS = Object.keys(KINDS);

export function classifyPrompt(langNote) {
  return `You are sorting a document a restaurant owner has uploaded.

Decide which ONE of these it is:

  supplier   — a delivery note, supplier invoice, or grocery receipt for goods
               bought BY the restaurant
  bill       — a customer's bill or sales receipt, for food sold BY the
               restaurant TO a diner
  recipe     — a recipe card, spec sheet or prep list with ingredient
               quantities
  inventory  — a stock take, shelf count or opening balance sheet
  unknown    — anything else, or a document that is genuinely two of these

The distinction that matters most is supplier against bill: both are lists of
lines with prices. A supplier document is money the restaurant PAID, usually
with a supplier's name, a delivery or invoice number, and quantities in kilos,
litres or cases. A bill is money a diner paid, usually with dish names from a
menu, a table or order number, and quantities in whole covers.

Answer "unknown" when you are not sure. A document filed as the wrong kind is
worse than one that is left for a person to place, because the wrong screen
will accept it and nobody will know where the numbers came from.

Respond with ONLY this JSON:
{
  "kind": "supplier" | "bill" | "recipe" | "inventory" | "unknown",
  "confidence": "high" | "medium" | "low",
  "why": "<one short sentence naming what you saw that decided it>",
  "pages": <number of distinct documents you can see, or 1>
}
${langNote}`;
}

/* Where a classified document should go, and whether this person may take it
   there. The capability is checked because a cashier can photograph a delivery
   note but has no business receiving it into stock — routing them to a screen
   they cannot use would be the empty-screen failure the tab map exists to
   prevent. */
export function routeFor(kind, capabilities = []) {
  const route = KINDS[kind];
  if (!route) return { kind: "unknown", allowed: false };
  return {
    kind,
    tab: route.tab,
    scanner: route.scanner,
    needs: route.needs,
    allowed: capabilities.includes(route.needs),
  };
}

export function normaliseVerdict(parsed) {
  const kind = KIND_KEYS.includes(parsed?.kind) ? parsed.kind : "unknown";
  const confidence = ["high", "medium", "low"].includes(parsed?.confidence)
    ? parsed.confidence
    : "low";
  return {
    kind,
    /* A low-confidence placement is treated as no placement. The screen offers
       it as a suggestion the person confirms rather than a destination it
       jumps to, because being taken to the wrong screen is more annoying than
       being asked. */
    certain: kind !== "unknown" && confidence === "high",
    confidence,
    why: String(parsed?.why || "").slice(0, 200),
    pages: Number(parsed?.pages) > 0 ? Number(parsed.pages) : 1,
  };
}
