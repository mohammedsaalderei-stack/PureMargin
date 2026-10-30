import { convert, sameDimension, dimensionOf } from "./_units.js";
import { normaliseUnit, tidyUnitWord } from "./_unitwords.js";

/* What one of something is, for one ingredient.

   ── The gap ──────────────────────────────────────────────────────────────

   `_units.js` converts inside a dimension and refuses across one, and it is
   right to: a litre of oil is not a kilogram of oil, and a lemon is not any
   number of grams until somebody says which lemon. That refusal used to land
   on whoever was scanning. A recipe card saying "2 lemons" against a shelf
   kept in kilograms would not save. A delivery note saying "1 tin" of oil
   against a shelf kept in litres went unreceived. Each was one fact short —
   how much one lemon weighs, how much one tin holds — and the screen asked a
   person for it.

   That fact belongs to the ingredient, not to the unit system, which is where
   the comment in `_units.js` always said the density lived. So an ingredient
   now carries it: "one ea is 0.1 kg", "one tin is 18 l", "one pinch is 0.5 g".

   ── Where the number comes from ──────────────────────────────────────────

   The model reading the document supplies it, because it can see what a
   kitchen can see: that the lemon is a lemon, that a sunflower-oil tin in the
   Gulf is eighteen litres. Where the paper states it ("Tin 18 L") it is
   transcription and is marked as printed; where it does not, it is the model's
   estimate and is marked as one, all the way to the screen. Estimated is not
   hidden — it is labelled, the same way an estimated cost is.

   ── Why it is remembered ─────────────────────────────────────────────────

   Once a delivery or a recipe is saved with a conversion, the ingredient keeps
   it. The next document saying "tin" or "2 lemons" converts without asking the
   model anything, and a hand-written recipe saved from the form works too. A
   printed conversion replaces an estimated one; an estimate never replaces
   anything but an estimate. */

const round6 = (n) => Math.round(n * 1e6) / 1e6;
const MAX_KEPT = 24;

/* A package or a kitchen measure the ledger has no unit for — "jar", "تنكة",
   "pinch", "bunch" — as the key it is stored under. Words only: a phrase with
   a number in it is a quantity, not a name for one. */
function wordKey(raw) {
  const word = tidyUnitWord(raw).replace(/[\d()[\]{}"'*×/\\+-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!word || word.length > 30) return null;
  /* One clove and two cloves are the same measure, and the reader writes
     whichever the card did. English plurals only: the other scripts here
     either do not inflect a measure word this way or are matched whole. */
  return word
    .replace(/(x|s|ch|sh)es$/, "$1")
    .replace(/([a-z]{2}[^s])s$/, "$1");
}

/* The model's statement, or a stored one, in one shape:

     { from, kind: "unit" | "word", qty, unit, estimated }

   meaning "one `from` is `qty` `unit`". `unit` is always a ledger unit; `from`
   is a ledger unit (kind "unit") or a word (kind "word").

   When `shelf` is given, `unit` must measure what the shelf measures and is
   restated into the shelf's own unit, so a stored conversion is always in the
   terms its ingredient is kept in. A conversion inside one dimension is
   refused: kilograms to grams is arithmetic `convert` already does exactly,
   and accepting "1 kg is 900 g" would let a guess contradict it. */
export function readConversion(raw, shelf) {
  if (!raw || typeof raw !== "object") return null;
  const qty = Number(raw.qty);
  if (!Number.isFinite(qty) || qty <= 0) return null;

  let unit = normaliseUnit(raw.unit);
  if (!unit) return null;
  let amount = qty;
  if (shelf) {
    const to = normaliseUnit(shelf);
    if (!to || !sameDimension(unit, to)) return null;
    amount = convert(qty, unit, to);
    unit = to;
  }

  const fromUnit = normaliseUnit(raw.from);
  if (fromUnit && sameDimension(fromUnit, unit)) return null;
  const from = fromUnit || wordKey(raw.from);
  if (!from) return null;

  return {
    from,
    kind: fromUnit ? "unit" : "word",
    qty: round6(amount),
    unit,
    /* Printed only when the model says so in as many words. A conversion with
       no say either way is treated as the weaker kind. */
    estimated: raw.estimated !== false,
  };
}

/* The list an ingredient keeps, with anything malformed dropped. */
export function cleanConversions(list, shelf) {
  return (Array.isArray(list) ? list : [])
    .map((c) => readConversion(c, shelf))
    .filter(Boolean)
    .slice(-MAX_KEPT);
}

/* One entry per thing converted from: one count-to-mass figure, one per word. */
function keyOf(c) {
  return c.kind === "unit" ? `dim:${dimensionOf(c.from)}` : `word:${c.from}`;
}

export function mergeConversions(existing, incoming) {
  const out = [...(Array.isArray(existing) ? existing : [])];
  for (const c of incoming || []) {
    if (!c) continue;
    const at = out.findIndex((x) => keyOf(x) === keyOf(c));
    if (at === -1) out.push(c);
    else if (!c.estimated || out[at].estimated) out[at] = c;
  }
  return out.slice(-MAX_KEPT);
}

/* One conversion applied to a written quantity, or null when it does not
   speak about what was written. */
function apply(c, qty, written, shelf) {
  if (!c || !sameDimension(c.unit, shelf)) return null;
  const u = normaliseUnit(written);

  let howMany = null;
  if (c.kind === "unit") {
    if (u && sameDimension(u, c.from)) howMany = convert(qty, u, c.from);
  } else if (!u && wordKey(written) === c.from) {
    howMany = qty;
  }
  if (!(howMany > 0)) return null;

  const out = convert(howMany * c.qty, c.unit, shelf);
  return Number.isFinite(out) && out > 0
    ? { qty: round6(out), unit: shelf, via: "conversion", estimated: c.estimated, rule: c }
    : null;
}

/* A written quantity in the unit `item` is kept in, by whatever is known.

   In order of how much the answer is worth:
     1. the same kind of unit — plain arithmetic;
     2. the item's own package, where the written word is its purchase unit;
     3. a conversion the document itself printed;
     4. one the ingredient already keeps;
     5. one the model estimated for this document.

   `item` is { stockUnit, purchaseUnit?, packSize?, conversions? } — an
   ingredient, or the proposal for one that a commit is about to create.
   Returns null when nothing reaches the shelf's unit, which is still the case
   a person has to answer. */
export function toShelf(qty, written, item, told = []) {
  const n = Number(qty);
  const shelf = normaliseUnit(item?.stockUnit);
  if (!Number.isFinite(n) || n <= 0 || !shelf) return null;

  const u = normaliseUnit(written);
  if (u && sameDimension(u, shelf)) {
    return { qty: round6(convert(n, u, shelf)), unit: shelf, via: "unit", estimated: false, rule: null };
  }

  const buys = item?.purchaseUnit;
  const pack = Number(item?.packSize);
  if (!u && buys && pack > 0 && wordKey(buys) && wordKey(buys) === wordKey(written)) {
    const inBuys = normaliseUnit(buys);
    if (!inBuys) {
      return { qty: round6(n * pack), unit: shelf, via: "pack", estimated: false, rule: null };
    }
  }

  const stated = (told || []).filter(Boolean);
  const kept = cleanConversions(item?.conversions, shelf);
  const order = [
    ...stated.filter((c) => !c.estimated),
    ...kept,
    ...stated.filter((c) => c.estimated),
  ];
  for (const c of order) {
    const hit = apply(c, n, written, shelf);
    if (hit) return hit;
  }
  return null;
}
