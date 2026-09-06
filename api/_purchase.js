import { listIngredients } from "./_inventory.js";
import { normaliseUnit, isPackaging, toStockUnit } from "./_unitwords.js";
import { sameDimension, unitLabel, dimensionOf } from "./_units.js";
import { normaliseText, words } from "./_text.js";
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

/* One normaliser for the whole app, in _text.js. It lived here too, and the
   two copies drifted: the unit reader folded Arabic letter forms and this one
   did not, so "حبه" resolved as a unit while "زبده" failed to find "زبدة" on
   the shelf. It now also covers Urdu keyboard variants, Devanagari nukta and
   Latin accents, so every language the app is used in folds the same way. */
const norm = normaliseText;

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
  /* Arabic writes "the" as a prefix, so a supplier's "اللحم المفروم" and a
     shelf's "لحم مفروم" share no token at all until it comes off — the same
     failure the plural rules below exist for, in a different language. Only
     removed when what is left is still a word. */
  if (/^ال/.test(word) && word.length > 4) return word.slice(2);
  /* English plural folding. Applied only to Latin words: Arabic does not form
     plurals by adding an s, and running these rules over it would quietly
     shorten real words. */
  if (!/^[a-z0-9]+$/.test(word)) return word;
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s")) return word.slice(0, -1);
  return word;
}

/* Words, in any script.

   This split on `[^a-z0-9]+`, which does not merely ignore Arabic — it deletes
   it. Every Arabic description tokenised to the empty set, so `score` returned
   0 for all of them and the fallback matcher was dead in the language most of
   this app's users read. An Arabic invoice matched only when the model happened
   to name the ingredient exactly, or when somebody had already committed that
   wording once and taught the alias table. Nothing failed loudly; lines simply
   arrived unmatched, and the screen asked a person, every time. */
const tokens = (s) => new Set(words(s).filter((w) => w.length > 2).map(stem));

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

/* More than half the ingredient's own words, not half of them.

   Half was the rule, and half of a two-word name is one word — so an
   ingredient called "Tomatoes fresh" was matched by every line containing the
   word "fresh". A delivery of "ثوم مفروم طازج (Fresh Garlic)" was written
   against the tomatoes at exactly the floor, and so would parsley, and so
   would fish. The one word they shared was an adjective about condition, and
   the word that said what the thing actually was counted for nothing.

   Strictly greater fixes it without a list of stop words in five languages: a
   single shared modifier can no longer carry a two-word name, while a genuine
   partial match — two words of a three-word name — still passes.

   Missing a match costs almost nothing here. An unmatched line is not a
   failure: it arrives as a row with the ingredient list beside it and a
   proposal to create what the scan described, so a person redirects it in one
   tap. A wrong match is silent, and this file already says why that is worse —
   nothing downstream contradicts a delivery filed against the wrong shelf. */
export function bestMatch(text, ingredients, floor = 0.5) {
  let winner = null;
  let best = 0;
  for (const ing of ingredients) {
    /* The name, and every other name it is known by. An alias is a whole
       separate name rather than extra words on the existing one — scoring
       "Ground beef لحم مفروم" as one string would dilute both, so each is
       scored on its own and the best one stands. */
    for (const candidate of [ing.name, ...(ing.aliases || [])]) {
      const s = score(text, candidate);
      if (s > best) { best = s; winner = ing; }
    }
  }
  return best > floor ? { ingredient: winner, confidence: Math.round(best * 100) / 100 } : null;
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
/* The friendlier shelf unit for each kind of thing. A store counts in kilos
   and litres; grams and millilitres are what the arithmetic uses underneath. */
const SHELF_DEFAULT = { mass: "kg", volume: "l", count: "ea" };

/* What unit to keep a brand-new ingredient in.

   ── The bug this fixes ───────────────────────────────────────────────────

   The model's answer used to win outright, and the model is guessing: it sees
   "GRILLING BUTTER" and answers "ea" because butter often comes in packs. The
   line said 0.5 kg. So the commit created an ingredient counted in pieces and
   then, two steps later, tried to receive half a kilogram into it — and the
   ledger refused, correctly, because a piece is not a weight.

   One line out of forty-eight, self-inflicted, and invisible: the delivery
   reported "47 of 48 recorded, not recorded: Grilling butter" about an
   ingredient it had just created itself.

   ── The rule ─────────────────────────────────────────────────────────────

   The printed unit is evidence about the delivery; the model's answer is
   inference about the shelf. Where they disagree the delivery wins, because a
   shelf unit that cannot accept the line that created it is wrong by
   construction. The model's answer is still preferred whenever it measures the
   same kind of thing — it is the better shelf unit, "kg" where the invoice
   happened to print grams. */
export function shelfUnitFor(proposed, measuredIn) {
  const ok = (u) => Boolean(u) && UNITS_OK.has(u);

  if (measuredIn) {
    if (ok(proposed) && sameDimension(proposed, measuredIn)) return proposed;
    if (ok(measuredIn)) return measuredIn;
    /* A real unit, but not one a shelf is kept in — pounds, ounces, gallons.
       Keep the dimension and use the unit a store would label with. */
    return SHELF_DEFAULT[dimensionOf(measuredIn)] || "kg";
  }

  /* Nothing readable on the line — a packaging word with no contents stated.
     The model's answer is all there is. */
  return ok(proposed) ? proposed : "kg";
}

export function proposeItem(line, text, printedUnit) {
  const raw = line.newItem || {};
  const name = String(raw.name || "").trim();
  const fromPaper = normaliseUnit(printedUnit);
  /* The unit inside the package, where the line described one. This is the
     best evidence available for a brand-new ingredient: a line reading
     "1 Carton (12 x 1L Bottles)" says plainly that the thing is a liquid kept
     in litres, and nothing else on the line does. Without it the fallback for
     an unrecognised package word was kilograms — a carton of milk arriving on
     the shelf as a mass. */
  const inner = normaliseUnit(line.pack?.unit);

  /* Read rather than matched: the model is asked for one of kg|g|l|ml|ea, and
     when it is reading an Arabic delivery note it sometimes answers in the
     document's own words. "كجم" is a kilogram, and treating it as unrecognised
     sent the proposal to the "kg" default by luck rather than by reading. */
  const proposed = normaliseUnit(raw.stockUnit);
  const stockUnit = shelfUnitFor(proposed, fromPaper || inner);

  /* How many stock units are in one of whatever the supplier sells by. The
     line's own bracket beats the model's guess at it: one is transcription,
     the other is inference. */
  const contents = packContents(line.pack, stockUnit);

  return {
    name: name || String(text || "").slice(0, 40),
    stockUnit,
    purchaseUnit: String(raw.purchaseUnit || printedUnit || stockUnit).trim() || stockUnit,
    packSize: contents?.qty > 0
      ? contents.qty
      : (Number(raw.packSize) > 0 ? Number(raw.packSize) : 1),
    category: CATEGORIES_OK.has(String(raw.category).toLowerCase())
      ? String(raw.category).toLowerCase()
      : null,
  };
}

/* What one package on a line actually contains, in the shelf's own unit.

   ── The gap this closes ──────────────────────────────────────────────────

   A delivery note says "1 Carton (12 x 1L Bottles) @ 24.00". "Carton" is not a
   unit — it is packaging, and the ledger rightly refuses to guess what one
   holds. Until now the only way to reconcile that line was for the ingredient
   to already carry a `purchaseUnit` of "carton" and a `packSize` of 12, set by
   somebody in advance. A carton nobody had described yet went unreceived, and
   the screen could only ask how much one holds.

   But the invoice said. It is printed on the line, in brackets, right there.

   ── Why the multiplication is here and not in the model ──────────────────

   The model reports three printed numbers — how many inner units, how big each
   is, and what unit that is — and this does the arithmetic. Asking it for a
   finished `totalBaseQuantity` would put a computed figure in the same field
   as a transcribed one, and once stored the two are indistinguishable: nothing
   downstream could tell a quantity that was read from one that was worked out,
   and a slip of a decimal place looks exactly like a large delivery.

   Returns null whenever anything is missing or does not reconcile. A pack size
   that is wrong multiplies a stock balance by the size of the mistake, so the
   honest answer to a half-read bracket is no answer. */
export function packContents(pack, stockUnit) {
  if (!pack || !stockUnit) return null;

  const count = num(pack.count);
  const size = num(pack.size);
  const inner = normaliseUnit(pack.unit);
  if (!(count > 0) || !(size > 0) || !inner) return null;

  /* A carton of bottles is a volume only if the bottles are measured in one.
     Twelve bottles against a shelf counted in kilograms is still a question
     for a person. */
  if (!sameDimension(inner, stockUnit)) return null;

  const one = toStockUnit(size, inner, stockUnit);
  if (!one || !(one.qty > 0)) return null;

  /* `size`/`innerUnit` are what the line printed, `each`/`qty` what that
     comes to on the shelf. Both travel, because "12 × 1 L" is what somebody
     can check against the paper and "12,000 ml" is what gets received. */
  return { qty: count * one.qty, unit: stockUnit, count, size, innerUnit: inner, each: one.qty };
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
    /* What one package on this line holds, if the line said. Read before the
       routes below so the invoice's own statement outranks anything stored:
       a supplier who changes from twelve-bottle cartons to twenty-four prints
       the new number on the note, and the ingredient's saved pack size is then
       last month's answer. */
    const stated = packContents(line.pack, stockUnit);

    const asStockUnit = (() => {
      if (perInvoiceUnit === null || !stockUnit) return { unitCost: perInvoiceUnit, qty };

      if (unit && sameDimension(unit, stockUnit)) {
        const inStock = toStockUnit(qty, unit, stockUnit);
        if (inStock && inStock.qty > 0) {
          return { unitCost: (total || 0) / inStock.qty, qty: inStock.qty, converted: true };
        }
      }

      /* The bracket on the line. "1 Carton (12 x 1L)" against a shelf kept in
         millilitres is twelve thousand of them, and the cost of one is the
         line total over that. */
      if (stated && stated.qty > 0) {
        const stockQty = qty * stated.qty;
        return {
          unitCost: (total || 0) / stockQty, qty: stockQty, converted: true, viaStatedPack: true,
        };
      }

      const pack = Number(hit?.ingredient?.packSize);
      const buys = hit?.ingredient?.purchaseUnit;
      if (pack > 0 && buys && printed && buys.toLowerCase() === printed.toLowerCase()) {
        const stockQty = qty * pack;
        return { unitCost: (total || 0) / stockQty, qty: stockQty, converted: true, viaPack: true };
      }

      return { unitCost: perInvoiceUnit, qty, unknown: true };
    })();

    /* Six places, not four.

       Four was enough while a unit cost meant "per kilo" or "per litre" — a
       hundredth of a fils on a figure around twenty. It stopped being enough
       the moment costs are stated per gram and per millilitre, which is three
       orders of magnitude smaller: 100.00 spread over 24,000 ml is 0.00416667
       each, and at four places that becomes 0.0042 — which multiplies back to
       100.80. Eight tenths of a percent, added to every converted line, in the
       direction that quietly overstates what the store is worth.

       Six places brings that to under a hundredth of a dirham on a hundred
       dirham line, and matches what `_units.js` and `_recipes.js` already
       round quantities to, so a cost and the quantity it is paired with are
       carried at the same precision. */
    const unitCost = asStockUnit.unitCost === null
      ? null
      : Math.round(asStockUnit.unitCost * 1e6) / 1e6;

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

    /* Whether the ledger will take this line, decided here rather than found
       out on save.

       A forty-eight line delivery used to be refused as a whole for one line
       the ledger would not accept, and the message named neither the line nor
       the reason. That refusal is now partial and it names the ingredient —
       but the review list is closed by default and forty-eight rows long, so
       "Brioche buns is kept in ea and the line says kg" still starts a hunt.

       Everything needed to know this is already in hand before anybody presses
       anything: the unit as read, the unit the shelf keeps, and whether any of
       the three conversion routes above reached the second from the first. So
       it travels with the line and the row can say so itself.

       Measured against the ingredient that will exist after the commit: a line
       that matched nothing creates one from `newItem`, and it is that unit the
       delivery will be received in. */
    const willBeStockedIn = stockUnit
      || (hit ? null : normaliseUnit(proposeItem(line, text, printed).stockUnit));

    const trouble = (() => {
      if (!willBeStockedIn) return null;
      if (asStockUnit.converted) return null;
      if (unit && sameDimension(unit, willBeStockedIn)) return null;
      /* A package word is its own question — how much does one hold — and the
         invoice may yet answer it in a bracket next time. */
      return isPackaging(printed) ? "packaging" : "unit";
    })();

    return {
      text,
      qty,
      unit: unit || printed,
      receiveQty,
      receiveUnit,
      printedUnit: printed,
      packaging: !unit && isPackaging(printed),
      /* The package as the line described it, so the screen can show "12 × 1 L"
         beside a carton rather than leaving somebody to wonder where twelve
         thousand millilitres came from. Null when the line said nothing, which
         is still the case a person has to answer. */
      /* Display only — the receiving uses receiveQty/receiveUnit — so the
         units come as labels rather than ledger keys. "1 L" is what the
         supplier printed; "1 l" is what the database calls it. */
      pack: stated
        ? {
            count: stated.count, size: stated.size, each: stated.each, qty: stated.qty,
            innerUnit: unitLabel(stated.innerUnit), unit: unitLabel(stated.unit),
          }
        : null,
      viaStatedPack: Boolean(asStockUnit.viaStatedPack),
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
      /* Null when the line will go in. "unit" when what is written measures a
         different kind of thing from the shelf, "packaging" when it names a
         package whose contents nothing has stated. Both are questions for a
         person; neither is a reason to hold up the other forty-seven lines. */
      trouble,
      /* The unit this line will actually be stocked in, for the row to quote.
         The stock unit as the ledger keeps it, not its long label: the balance
         list two panels down prints exactly this string under every quantity,
         and a message saying "kept in each" beside a row reading "ea" makes a
         reader check whether they are the same thing. */
      stocksIn: willBeStockedIn || null,
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
