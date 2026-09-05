import { listIngredients } from "./_inventory.js";
import { normaliseUnit, isPackaging, toStockUnit } from "./_unitwords.js";
import { bestMatch, proposeItem } from "./_purchase.js";

/* A recipe card, read off a photograph.

   Recipes in a real kitchen live on a laminated card by the pass, in a
   notebook, or in the head of whoever wrote them. Typing one into a form is
   the single largest piece of setup work this product asks for, and it is the
   work that stops people finishing setup — a business with no recipes gets no
   costs, no leakage and no depletion, which is most of what they paid for.

   Same division of labour as the other scanners. The model transcribes what is
   written: a dish name, how many portions it makes, and a list of quantities.
   Matching those against the ingredient master, converting nothing, and
   building the version is done here, because a model asked to name an
   ingredient id invents a plausible one and an invented id silently attaches a
   recipe to the wrong shelf.

   Nothing is saved from this file. It produces a draft, a person confirms it,
   and the existing saveVersion writes it — so a misread quantity is caught on
   a screen rather than in a cost report three weeks later. */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/* Fractions are how recipe cards are actually written. "1/2 kg" and "1½ tsp"
   both appear on the same card, and reading either as null throws away a line
   the photograph got perfectly right. */
export function parseQty(raw) {
  if (typeof raw === "number") return num(raw);
  const text = String(raw ?? "").trim();
  if (!text) return null;

  const VULGAR = { "½": 0.5, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 0.25, "¾": 0.75, "⅛": 0.125 };
  for (const [glyph, value] of Object.entries(VULGAR)) {
    if (text.includes(glyph)) {
      const whole = Number(text.replace(glyph, "").trim());
      return num((Number.isFinite(whole) ? whole : 0) + value);
    }
  }

  const mixed = text.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) return num(Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]));

  const fraction = text.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fraction) return num(Number(fraction[1]) / Number(fraction[2]));

  return num(parseFloat(text));
}

export function buildRecipe(parsed, ingredients) {
  /* One mapper, used for the food lines and the packaging lines alike. They
     are the same shape and the same matching problem — a box the store already
     stocks should resolve like a tomato does — and the only difference is which
     list they end up in on the recipe. */
  const readLine = (line) => {
    const text = String(line.text || line.name || "").trim();
    const qty = parseQty(line.qty);
    const printed = String(line.unit || "").trim();
    const unit = normaliseUnit(printed);
    /* The model was given the real list and asked to pick from it. Trust that
       pick only after checking the name is actually on the list — a model asked
       to choose from a list will occasionally return something adjacent to it —
       and fall back to token matching when it declined or invented.

       This order matters. The model sees the whole line in context and can tell
       that "TOMATO RED 5KG BOX" is the tomatoes; token overlap cannot see
       through a supplier's abbreviations nearly as well. Doing it the other way
       round was what left lines unmatched and sent people to a dropdown. */
    const named = String(line.ingredient || "").trim().toLowerCase();
    const chosen = named
      ? ingredients.find((i) => i.name.trim().toLowerCase() === named)
      : null;
    const hit = chosen
      ? { ingredient: chosen, confidence: 1 }
      : bestMatch(text, ingredients);
    const stockUnit = hit?.ingredient?.stockUnit || null;
    const inStock = unit && stockUnit ? toStockUnit(qty, unit, stockUnit) : null;

    return {
      text,
      qty,
      /* A card written in cups or in ملعقة كبيرة names a unit the ledger keeps;
         one written in "handful" does not, and says so rather than silently
         becoming something. */
      unit: unit || printed,
      printedUnit: printed,
      packaging: !unit && isPackaging(printed),
      stockQty: inStock ? inStock.qty : null,
      converted: Boolean(inStock?.converted),
      ingredientId: hit?.ingredient?.id || null,
      ingredientName: hit?.ingredient?.name || null,
      confidence: hit?.confidence ?? 0,
      /* Carried so the screen can flag a card written in cups against a shelf
         counted in kilos, which is a conversion nobody should be guessing. */
      stockUnit,
      /* What to create when the card names something the store does not have.
         On a new account that is every line, which is exactly when being sent
         to a form is most discouraging. */
      newItem: hit ? null : proposeItem(line, text, printed),
    };
  };

  const asList = (v) => (Array.isArray(v) ? v : []);
  const lines = asList(parsed?.lines).map(readLine);
  /* Boxes, cups, lids. Kept apart from the food because a food-cost percentage
     that includes clamshells is not comparable with anybody's benchmark — the
     recipe module has always summed the two separately, and the card scanner
     now feeds both rather than dropping the packaging on the floor. */
  const packaging = asList(parsed?.packaging).map(readLine);

  const matched = lines.filter((l) => l.ingredientId);

  return {
    menuItem: String(parsed?.menuItem || parsed?.title || "").trim(),
    /* What section of the menu it belongs to, as the card said. One free-text
       field, not a tree: a kitchen writes "Mains" on a card and nobody
       maintains a taxonomy. */
    category: String(parsed?.category || "").trim(),
    /* Only where the card actually printed a price. A recipe card usually does
       not, and a guessed selling price sets the margin on the dish to a number
       nobody chose. */
    sellPrice: num(parsed?.sellPrice),
    /* The food cost the card printed for itself.

       Very often a card states its cost while naming ingredients this system
       has never bought and has no price for. Carried through so the dish can
       be costed from what the kitchen already worked out, rather than
       reporting nothing until a dozen ingredients have been priced.

       Only where the card said it. Nothing is summed or inferred here — a
       derived figure presented as the card's own is the one mistake that
       cannot be spotted later. */
    statedCost: num(parsed?.foodCost),
    /* Per portion or per batch. A card giving one total for four servings
       means a quarter of it per dish, and reading a batch figure as a portion
       figure overstates every margin on the menu by the batch size. Unstated
       basis is treated as per portion, which is what a card without a
       "serves" line means. */
    statedCostBasis: String(parsed?.foodCostBasis || "").toLowerCase() === "batch"
      ? "batch" : "portion",
    /* A card that does not say how many it serves is the common case, and one
       is the honest default: it makes the quantities per-portion, which is
       what a card without a yield line usually means. A person can correct it,
       and the screen says so rather than hiding the assumption. */
    portions: num(parsed?.portions) || 1,
    portionsStated: num(parsed?.portions) !== null,
    /* Never guessed. Yield is trim and cooking loss, which is not written on
       a card and cannot be seen in a photograph; 100 means "as written". */
    yieldPct: 100,
    note: String(parsed?.note || "").trim(),
    lines,
    packaging,
    unmatched: lines.filter((l) => !l.ingredientId).map((l) => l.text).filter(Boolean),
    matchedCount: matched.length,
    complete: lines.length > 0 && matched.length === lines.length,
  };
}

export async function matchRecipe(orgId, parsed) {
  const ingredients = orgId ? await listIngredients(orgId) : [];
  return buildRecipe(parsed, ingredients);
}
