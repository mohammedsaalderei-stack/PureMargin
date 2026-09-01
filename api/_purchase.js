import { listIngredients } from "./_inventory.js";
import { normaliseUnit, isPackaging, toStockUnit } from "./_unitwords.js";
import { sameDimension } from "./_units.js";
import { slug } from "./_inventory.js";
import { aliasKey, resolveMany } from "./_aliases.js";

/* A supplier invoice, turned into something the store can receive.

   The kitchen already photographs a delivery note to check it against what
   arrived. This reads the same photograph and matches each line to an
   ingredient the business already keeps, so a delivery becomes stock and a
   fresh unit cost without anybody typing a purchase order.

   The matching is done here, against the real ingredient list, and never by
   the model. A model asked to "return the ingredient id" will invent a
   plausible one, and an invented id is worse than no match: it writes a
   delivery against something that does not exist, or worse, against something
   that does and is not it.

   What the model is asked for is what is printed — a description, a quantity,
   a unit, a line total. Everything after that is arithmetic and lookup, and
   both belong in code. */

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

/* Cheap similarity, deliberately not clever.

   A supplier writes "TOMATO RED 5KG BOX" where the ingredient is "Tomatoes".
   Token overlap catches that; an edit-distance score would also catch
   "Potatoes", which is the sort of near-miss that quietly ruins a stock
   balance. When nothing overlaps, the honest answer is no match, and the
   screen asks a person. */
/* Crude singular/plural folding. A shelf is labelled "Tomatoes" and an invoice
   says "TOMATO RED 5KG", which shares no token at all until the plural is
   taken off. Not linguistics — just enough that the commonest mismatch in a
   produce delivery stops costing a manual match. */
function stem(word) {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s")) return word.slice(0, -1);
  return word;
}

const tokens = (s) =>
  new Set(norm(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2).map(stem));

function score(text, name) {
  const a = tokens(text);
  const b = tokens(name);
  if (!a.size || !b.size) return 0;
  let hits = 0;
  for (const w of b) if (a.has(w)) hits += 1;
  /* Measured against the ingredient's own words, so a long supplier
     description does not dilute a complete match. */
  return hits / b.size;
}

export function bestMatch(text, ingredients, floor = 0.5) {
  let winner = null;
  let best = 0;
  for (const ing of ingredients) {
    const s = score(text, ing.name);
    if (s > best) { best = s; winner = ing; }
  }
  return best >= floor ? { ingredient: winner, confidence: Math.round(best * 100) / 100 } : null;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const UNITS_OK = new Set(["kg", "g", "l", "ml", "ea"]);
const CATEGORIES_OK = new Set(["produce", "meat", "dairy", "dry", "oil", "drink", "packaging"]);

/* The ingredient to create for a line that matched nothing.

   The model saw the whole line and knows a 5L tin is five litres; everything
   here is either its answer or a fallback for when it declined to give one.
   There is always a fallback, because a line without a usable proposal must
   still be creatable — the entire point is that nobody is sent to a form.

   What is never taken on trust is the unit. A name is corrected in a second; a
   unit outside the set the ledger keeps silently rescales every recipe cost
   built on the ingredient, so anything unrecognised falls back to the unit
   read off the supplier's own word. */
export function proposeItem(line, text, printedUnit) {
  const raw = line.newItem || {};
  const name = String(raw.name || "").trim();
  const fromPaper = normaliseUnit(printedUnit);

  const stockUnit = UNITS_OK.has(String(raw.stockUnit).toLowerCase())
    ? String(raw.stockUnit).toLowerCase()
    : (fromPaper && UNITS_OK.has(fromPaper) ? fromPaper : "kg");

  return {
    name: name || String(text || "").slice(0, 40),
    stockUnit,
    purchaseUnit: String(raw.purchaseUnit || printedUnit || stockUnit).trim() || stockUnit,
    packSize: Number(raw.packSize) > 0 ? Number(raw.packSize) : 1,
    category: CATEGORIES_OK.has(String(raw.category).toLowerCase())
      ? String(raw.category).toLowerCase()
      : null,
  };
}

const round2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);

/* Subtotal, tax and total, from whichever of the three the invoice printed.

   The header a person checks before pressing save is these three numbers, and
   invoices print an inconsistent subset of them: a VAT invoice usually prints
   all three, a small supplier's delivery note prints one, a receipt prints a
   total and a tax line and leaves the subtotal to be worked out.

   So each is taken as printed where it exists, and derived only where it does
   not — the two known ones always determine the third. Nothing is invented from
   a single figure: a total alone stays a total alone, with the tax null, rather
   than being split by an assumed rate. A 5% VAT is the rule in the UAE and not
   the rule everywhere, and a number that looks read off the paper but was
   actually assumed is the kind of wrong that never gets questioned.

   `linesTotal` is the fallback for a subtotal nothing states, since the lines
   are transcribed individually and their sum is a real observation rather than
   an assumption. */
export function totalsOf(parsed, lines) {
  const printedSub = num(parsed?.subtotal);
  const printedTax = num(parsed?.tax);
  const printedTotal = num(parsed?.total);

  const linesTotal = lines.reduce((sum, l) => sum + (l.amount || 0), 0) || null;

  const subtotal = printedSub
    ?? (printedTotal && printedTax ? round2(printedTotal - printedTax) : linesTotal);
  const total = printedTotal
    ?? (subtotal && printedTax ? round2(subtotal + printedTax) : null);
  const tax = printedTax
    ?? (printedTotal && subtotal ? round2(printedTotal - subtotal) : null);

  return {
    subtotal,
    tax,
    total: total ?? subtotal,
    /* Whether the three agree with each other. A subtotal and a tax that do not
       add up to the printed total means a line was misread, and that is worth
       saying before a delivery is committed on it. */
    totalsAgree: !(subtotal && tax && printedTotal)
      || Math.abs(subtotal + tax - printedTotal) < 0.02,
  };
}

export function buildPurchase(parsed, ingredients, aliases = new Map()) {
  const byId = new Map(ingredients.map((i) => [i.id, i]));

  const lines = (Array.isArray(parsed?.lines) ? parsed.lines : []).map((line) => {
    const text = String(line.text || line.description || "").trim();
    const qty = num(line.qty);
    const total = num(line.amount);

    const printed = String(line.unit || "").trim();
    const unit = normaliseUnit(printed);
    /* Three ways to know what a line is, in descending order of how much the
       answer is worth.

       1. **A learned alias.** Somebody already committed an invoice with this
          exact description against this ingredient. That is not a guess, it is
          a decision, and it beats anything derived fresh from the text — which
          is the entire reason the alias table exists.
       2. **The model's pick**, checked against the real list. It sees the whole
          line in context and can tell that "TOMATO RED 5KG BOX" is the
          tomatoes. Trusted only after confirming the name is actually on the
          list, because a model asked to choose from a list will occasionally
          return something adjacent to it.
       3. **Token overlap.** Cannot see through a supplier's abbreviations
          nearly as well, but it is honest about failing.

       This order matters. Doing it the other way round was what left lines
       unmatched and sent people to a dropdown. */
    const learned = aliases.get(aliasKey(text));
    const remembered = learned ? byId.get(learned.ingredientId) : null;

    const named = String(line.ingredient || "").trim().toLowerCase();
    const chosen = named
      ? ingredients.find((i) => i.name.trim().toLowerCase() === named)
      : null;

    const hit = remembered
      ? { ingredient: remembered, confidence: 1, viaAlias: true }
      : chosen
        ? { ingredient: chosen, confidence: 1 }
        : bestMatch(text, ingredients);

    /* Unit cost is derived, never read. An invoice usually prints a line total
       and a quantity; the per-unit figure it sometimes also prints is rounded
       for display, and using it would make the stock value drift from what was
       actually paid. */
    /* Cost per unit of whatever the invoice counted in — per tin, per sack,
       per kilo. Correct as far as it goes, and not yet what the ledger wants. */
    const stockUnit = hit?.ingredient?.stockUnit || null;
    const inStock = unit && stockUnit ? toStockUnit(qty, unit, stockUnit) : null;

    const perInvoiceUnit = qty && total ? total / qty : null;

    /* Restated into the unit the shelf is kept in.

       A supplier sells four tins at 68 each; the shelf counts litres and a tin
       holds five. Without this the ledger is told "68 per tin" and either
       refuses the line — a tin is not a unit it knows — or records a litre
       costing 68, which is out by a factor of five and silently wrong in every
       recipe built on it.

       Three routes, in order of how much is actually known. A unit the ledger
       already keeps converts directly. A packaging word with a pack size on
       the ingredient divides by it. Anything else leaves the figure alone and
       flags the line, because a guessed conversion is worse than an obvious
       gap. */
    const asStockUnit = (() => {
      if (perInvoiceUnit === null || !stockUnit) return { unitCost: perInvoiceUnit, qty };

      if (unit && sameDimension(unit, stockUnit)) {
        const inStock = toStockUnit(qty, unit, stockUnit);
        if (inStock && inStock.qty > 0) {
          return { unitCost: (total || 0) / inStock.qty, qty: inStock.qty, converted: true };
        }
      }

      const pack = Number(hit?.ingredient?.packSize);
      const buys = hit?.ingredient?.purchaseUnit;
      if (pack > 0 && buys && printed && buys.toLowerCase() === printed.toLowerCase()) {
        const stockQty = qty * pack;
        return { unitCost: (total || 0) / stockQty, qty: stockQty, converted: true, viaPack: true };
      }

      return { unitCost: perInvoiceUnit, qty, unknown: true };
    })();

    const unitCost = asStockUnit.unitCost === null
      ? null
      : Math.round(asStockUnit.unitCost * 10000) / 10000;

    /* The unit as printed, plus what it actually is. An invoice saying كجم or
       LBS names a unit this ledger keeps; one saying "sack" names a package,
       which is a different problem and gets said differently on screen. */

    /* The quantity-and-unit pair that goes to the ledger, guaranteed to be the
       same unit `unitCost` is stated in.

       This pairing used to be left to the caller, and the caller got it wrong.
       `unitCost` is restated into the shelf's unit just above — 114 for 5 kg of
       something kept in grams is 0.0228 a gram — while `qty` and `unit` stayed
       as the invoice printed them, 5 and "kg". A caller passing the printed
       pair with the restated cost had `recordMovement` divide by the conversion
       a second time, and the ledger recorded chicken at 0.0228 a kilo instead
       of 22.80. Out by a thousand, in the direction that makes food cost look
       wonderful, and invisible in every screen downstream.

       It only showed when the invoice's unit differed from the shelf's, which
       is why it survived: most lines are bought and kept in the same unit, and
       the ones that are not are exactly the ones nobody checks by hand.

       So the pair is emitted here, next to the cost it belongs with, and there
       is no longer a combination a caller can choose that disagrees. */
    const receiveUnit = asStockUnit.converted ? stockUnit : (unit || printed);
    const receiveQty = asStockUnit.converted ? asStockUnit.qty : qty;

    return {
      text,
      qty,
      unit: unit || printed,
      receiveQty,
      receiveUnit,
      printedUnit: printed,
      packaging: !unit && isPackaging(printed),
      /* The same quantity in the unit the shelf is kept in, when the two can be
         reconciled. Null when they cannot — a count is not a mass, and a pack
         size is something a person supplies rather than something to guess. */
      /* The quantity in the shelf's own unit, and the cost of one of those —
         which is the pair the ledger actually stores. */
      stockQty: asStockUnit.qty ?? (inStock ? inStock.qty : null),
      costUnknown: Boolean(asStockUnit.unknown),
      converted: Boolean(inStock?.converted),
      amount: total,
      unitCost,
      ingredientId: hit?.ingredient?.id || null,
      ingredientName: hit?.ingredient?.name || null,
      confidence: hit?.confidence ?? 0,
      /* Resolved from the table rather than worked out again. Surfaced so the
         screen can say "known supplier wording" instead of showing a
         confidence score for something nobody is guessing at. */
      viaAlias: Boolean(hit?.viaAlias),
      /* The unit the store keeps this in, so the screen can warn when the
         invoice speaks in cases and the shelf counts kilos. */
      stockUnit,
      /* What to create when nothing matched, so the delivery can be received
         in one press rather than sending somebody to fill in a form first. */
      newItem: hit ? null : proposeItem(line, text, printed),
    };
  });

  const matched = lines.filter((l) => l.ingredientId);
  return {
    supplier: String(parsed?.supplier || "").trim(),
    invoiceNo: String(parsed?.invoiceNo || "").trim(),
    date: String(parsed?.date || "").trim(),
    ...totalsOf(parsed, lines),
    lines,
    unmatched: lines.filter((l) => !l.ingredientId).map((l) => l.text).filter(Boolean),
    /* A count rather than a boolean, because "6 of 9 lines matched" is what
       decides whether somebody fixes three rows or gives up and types it. */
    matchedCount: matched.length,
    complete: lines.length > 0 && matched.length === lines.length,
  };
}

export async function matchPurchase(orgId, parsed) {
  const ingredients = orgId ? await listIngredients(orgId) : [];
  if (!orgId) return buildPurchase(parsed, ingredients);

  /* Every description on the invoice, looked up in one read. The set of live
     ingredient ids goes with it so an alias pointing at something that has
     since been deleted resolves to nothing rather than to a ghost. */
  const texts = (Array.isArray(parsed?.lines) ? parsed.lines : [])
    .map((l) => String(l.text || l.description || "").trim());
  const aliases = await resolveMany(orgId, texts, new Set(ingredients.map((i) => i.id)));

  return buildPurchase(parsed, ingredients, aliases);
}

export { slug };
