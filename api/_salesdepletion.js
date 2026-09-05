import { getJSON, setJSON } from "./_store.js";
import { listRecipes, effectiveVersion } from "./_recipes.js";
import { recordMovement } from "./_movements.js";

/* Taking stock out as sales come in.

   Until now nothing did. A bill scanned by hand could be deducted, and a
   kitchen that recorded its own issues had a ledger; a restaurant that did
   neither had a stock balance frozen at whatever it last counted, while sales
   ran on regardless.

   ── The catch, which is the whole reason this is a choice ──────────────────

   Leakage is `actual − theoretical`: what the ledger says left the store,
   against what the sales say should have left. Writing consumption *derived
   from those same sales* into the ledger makes the two sides the same number,
   and leakage reads zero forever. The screen that exists to find waste and
   theft would go quiet, and it would look like good news.

   So this is off by default and the trade-off is stated where it is switched
   on. With it off, leakage works as designed and someone has to record issues.
   With it on, the balance is live and leakage moves to the count sheet: you
   count the shelf, and the gap against the balance is the leak.

   To keep both honest, every movement written here carries `auto: true`, and
   the variance calculation ignores those. Counting derived usage as actual
   usage would be circular arithmetic dressed up as a finding.

   ── Not writing the same sale twice ────────────────────────────────────────

   Receipts arrive repeatedly — the metrics call re-reads the same window every
   few minutes. A high-water mark on time would be wrong, since a receipt can
   arrive late and one that arrives at the same millisecond as the mark is
   either skipped or doubled. So the receipt's own id is the key, and a set of
   ids already posted is kept per branch. A receipt seen twice does nothing the
   second time. */

const KEY = (orgId, branchId) => `deplete:posted:${orgId}:${branchId}`;

/* Till catalogue id → recipe id, learned from sales that matched by name.

   Org-level rather than per branch: a catalogue is one catalogue across the
   stores on an account, and learning the same pairing five times because five
   branches sell the burger is five times the writes for one fact. */
const PAIRS = (orgId) => `deplete:positems:${orgId}`;

export async function posPairings(orgId) {
  return (await getJSON(PAIRS(orgId))) || {};
}

async function rememberPairings(orgId, learned) {
  const map = await posPairings(orgId);
  let changed = false;
  for (const { posKey, recipeId } of learned) {
    if (!posKey || !recipeId || map[posKey] === recipeId) continue;
    map[posKey] = recipeId;
    changed = true;
  }
  if (changed) await setJSON(PAIRS(orgId), map);
}

/* Enough to cover a busy month, so a receipt cannot re-enter the window after
   being trimmed. Trimmed oldest-first, since an old receipt is not coming back. */
const MAX_REMEMBERED = 20000;

export async function postedIds(orgId, branchId) {
  return new Set((await getJSON(KEY(orgId, branchId))) || []);
}

async function remember(orgId, branchId, ids) {
  const known = [...(await postedIds(orgId, branchId)), ...ids];
  const trimmed = known.length > MAX_REMEMBERED ? known.slice(known.length - MAX_REMEMBERED) : known;
  await setJSON(KEY(orgId, branchId), trimmed);
}

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

/* Recipes indexed by what the till calls the dish, variant preferred — a large
   latte and a regular one share a POS name and genuinely differ.

   `posIds` maps a till catalogue id to a recipe id, and is consulted first.
   A name is edited — a seasonal rename, a fixed typo, a translation — and the
   rename silently stops a recipe matching its own sales. Nothing errors: the
   dish sells, nothing depletes, and it surfaces weeks later as an ingredient
   whose balance never moves. The catalogue id does not change when the label
   does, so once a pairing is known it survives the rename.

   It is learned rather than configured, on the same reasoning as the supplier
   alias table: the first sale matches by name, that pairing is written down,
   and every later sale of the same catalogue item resolves by id. Nobody is
   asked to type an id they would have to go and look up. */
export function indexRecipes(recipes, posIds = {}) {
  const byName = new Map();
  const byId = new Map();
  const live = new Map();

  for (const r of recipes || []) {
    if (r.archived) continue;
    byName.set(norm(r.menuItem), r);
    live.set(r.id, r);
  }

  for (const [posId, recipeId] of Object.entries(posIds || {})) {
    const recipe = live.get(recipeId);
    /* A pairing pointing at a recipe that has since been deleted resolves to
       nothing rather than to a ghost. */
    if (recipe) byId.set(posId, recipe);
  }

  return { byName, byId };
}

/* The catalogue key for one sold line. Variant first: a large latte and a
   regular one are different items to cost, and Loyverse gives them the same
   item_id with different variant_ids. */
export function posKeyOf(line) {
  const item = String(line?.itemId || "").trim();
  const variant = String(line?.variantId || "").trim();
  if (!item) return "";
  return variant ? `${item}:${variant}` : item;
}

/* Resolve one sold line to a recipe: by catalogue id where that is known,
   then by variant-qualified name, then by name alone. */
function recipeFor(line, index) {
  const key = posKeyOf(line);
  if (key && index.byId.has(key)) return index.byId.get(key);
  /* A variant-specific pairing is not known, but the plain item may be. */
  const bare = key.split(":")[0];
  if (bare && index.byId.has(bare)) return index.byId.get(bare);

  return index.byName.get(norm(line.variant ? `${line.name} ${line.variant}` : line.name))
    || index.byName.get(norm(line.name))
    || null;
}

/* What one receipt consumed, per ingredient, in base units. */
export function consumptionOf(receipt, index, at) {
  const totals = new Map();
  const unmatched = [];
  /* Catalogue-id pairings this receipt proved, for the caller to remember. */
  const learned = [];

  for (const line of receipt.lines || []) {
    const qty = Number(line.qty);
    if (!Number.isFinite(qty) || qty <= 0) continue;

    const recipe = recipeFor(line, index);
    const version = recipe ? effectiveVersion(recipe, at) : null;
    if (!version || !(version.lines || []).length) {
      if (line.name) unmatched.push(line.name);
      continue;
    }

    /* Matched, and the till gave a catalogue id we do not already have against
       this recipe. Worth writing down so the next rename does not break it. */
    const key = posKeyOf(line);
    if (key && index.byId.get(key)?.id !== recipe.id) {
      learned.push({ posKey: key, recipeId: recipe.id });
    }

    const portions = Number(version.portions) > 0 ? Number(version.portions) : 1;
    const factor = Number(version.yieldPct) > 0 ? Number(version.yieldPct) / 100 : 1;

    for (const ing of version.lines) {
      /* Gross, not net: yield is trim and cooking loss, and the store gave up
         the larger amount. */
      const per = (Number(ing.qtyBase) || 0) / factor / portions;
      const moved = per * qty;
      if (!(moved > 0)) continue;
      const key = `${ing.ingredientId}|${ing.baseUnit}`;
      const row = totals.get(key) || { ingredientId: ing.ingredientId, unit: ing.baseUnit, qty: 0 };
      row.qty += moved;
      totals.set(key, row);
    }
  }

  return {
    movements: [...totals.values()].map((m) => ({ ...m, qty: Math.round(m.qty * 1e6) / 1e6 })),
    unmatched: [...new Set(unmatched)],
    learned,
  };
}

/* Post everything not yet posted for one branch.

   Returns what it did rather than throwing on a partial failure: this runs
   behind a metrics refresh, and a single unpriced ingredient must not stop the
   rest of a day's sales from being recorded. */
export async function depleteFromSales(orgId, branchId, receipts, { at = Date.now(), actor = "system" } = {}) {
  if (!orgId || !branchId) return { posted: 0, skipped: 0, movements: 0, unmatched: [] };

  const seen = await postedIds(orgId, branchId);
  const fresh = (receipts || []).filter((r) => r.id && !seen.has(r.id));
  if (!fresh.length) return { posted: 0, skipped: (receipts || []).length, movements: 0, unmatched: [] };

  const pairings = await posPairings(orgId);
  const index = indexRecipes(await listRecipes(orgId), pairings);
  const unmatched = new Set();
  const done = [];
  const learned = [];
  let written = 0;

  for (const receipt of fresh) {
    const out = consumptionOf(receipt, index, receipt.at || at);
    for (const name of out.unmatched) unmatched.add(name);
    learned.push(...out.learned);

    /* A receipt whose dishes have no recipes still counts as posted. It
       consumed nothing this system can know about, and leaving it unposted
       would mean re-reading it forever. */
    let ok = true;
    for (const m of out.movements) {
      const written_ = await recordMovement(orgId, branchId, {
        ingredientId: m.ingredientId,
        qty: m.qty,
        unit: m.unit,
        type: "consume",
        auto: true,
        /* The till's receipt number, on the entry rather than only in prose.
           `ref` is what a query filters on, so "show me everything receipt
           2-1043 consumed" is answerable — which is the difference between a
           ledger you can audit and one you can only read. */
        ref: String(receipt.id || ""),
        note: `POS ${receipt.id}`,
        actor,
      });
      if (written_.error) { ok = false; break; }
      written += 1;
    }
    if (ok) done.push(receipt.id);
  }

  if (done.length) await remember(orgId, branchId, done);
  /* Written after the movements, and only for receipts that posted: a pairing
     learned from a receipt that failed halfway would outlive the thing that
     justified it. */
  if (learned.length) await rememberPairings(orgId, learned);

  return {
    posted: done.length,
    skipped: (receipts || []).length - fresh.length,
    movements: written,
    unmatched: [...unmatched],
    learned: learned.length,
  };
}
