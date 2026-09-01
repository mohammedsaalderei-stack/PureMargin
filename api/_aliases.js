/* What a supplier calls a thing, against what the kitchen calls it.

   A delivery note says `TOMATO RED 5KG BOX GRD-A`. The shelf says `Tomatoes`.
   Token overlap gets that right most of the time and wrong some of the time,
   and "some of the time" is the whole problem: every invoice from that supplier
   asks the same question again, and a match that needed correcting once needs
   correcting every month forever.

   So the answer is remembered. The first time a description is resolved — by
   the matcher or by a person fixing it — the pairing is written down, and every
   later invoice carrying that description resolves from this table instead of
   being guessed at again. The matcher stops being asked a question it has
   already been asked.

   Three properties this has to have, and they are the reason it is a module
   rather than a Map somewhere:

   1. **An alias is evidence, not a rule.** It records that somebody accepted
      this pairing, so it wins over a fresh guess — but it is dropped the moment
      the ingredient it points at stops existing. An alias resolving to a
      deleted ingredient would write a delivery against nothing.
   2. **Learning happens on commit, never on parse.** Parsing is a proposal;
      committing is a person saying the proposal was right. Learning from a
      parse would teach the table its own guesses and make a wrong match
      permanent on the strength of nothing.
   3. **The text is the key, normalised.** Suppliers vary spacing and case
      between runs of the same printer, and `TOMATO RED  5KG` and
      `Tomato Red 5kg` are one description, not two.

   Isolation follows the rest of stage 4: the org id is part of the key, so one
   organization's vocabulary is unreachable from another's. */

import { getJSON, setJSON, del } from "./_store.js";

const ALIASES = (orgId) => `inv:${orgId}:aliases`;

/* Enough for years of invoices from a dozen suppliers. Capped anyway, because
   an OCR failure can produce a description that is unique every time — a line
   of noise with a different serial in it — and an uncapped table would grow
   forever on entries that will never be looked up again.

   Trimmed by least-used, then oldest. An alias with fifty hits is the house
   vocabulary; one with a single hit from eight months ago was probably noise. */
const MAX_ALIASES = 5000;

/* The same normalisation `_purchase.js` matches on, and deliberately the same:
   an alias keyed differently from the way descriptions are compared would miss
   on exactly the lines it exists to catch. */
export function aliasKey(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 200);
}

async function read(orgId) {
  return (await getJSON(ALIASES(orgId))) || {};
}

/* Every learned pairing, newest first. For the screen that shows what the
   system has worked out, and for the one that corrects it. */
export async function listAliases(orgId) {
  const map = await read(orgId);
  return Object.entries(map)
    .map(([text, row]) => ({ text, ...row }))
    .sort((a, b) => (b.learnedAt || 0) - (a.learnedAt || 0));
}

/* Resolve one description.

   `known` is the set of ingredient ids that currently exist, and passing it is
   not optional in practice: an alias outliving its ingredient is the one way
   this table can do damage, and checking here means no caller can forget. An
   alias that fails the check is reported as a miss rather than deleted — the
   ingredient may be archived rather than gone, and a read path should not have
   write side effects. `prune` is what removes them. */
export async function resolveAlias(orgId, text, known) {
  const key = aliasKey(text);
  if (!key) return null;
  const row = (await read(orgId))[key];
  if (!row?.ingredientId) return null;
  if (known && !known.has(row.ingredientId)) return null;
  return { ingredientId: row.ingredientId, hits: row.hits || 0, learnedAt: row.learnedAt || null };
}

/* Resolve many descriptions against one read of the table.

   The invoice path asks about every line at once, and going back to the store
   per line would turn a nine-line delivery into nine round trips for a lookup
   that is one object. */
export async function resolveMany(orgId, texts, known) {
  const map = await read(orgId);
  const out = new Map();
  for (const text of texts || []) {
    const key = aliasKey(text);
    if (!key) continue;
    const row = map[key];
    if (!row?.ingredientId) continue;
    if (known && !known.has(row.ingredientId)) continue;
    out.set(key, { ingredientId: row.ingredientId, hits: row.hits || 0 });
  }
  return out;
}

function trim(map) {
  const entries = Object.entries(map);
  if (entries.length <= MAX_ALIASES) return map;
  entries.sort((a, b) =>
    (b[1].hits || 0) - (a[1].hits || 0) || (b[1].learnedAt || 0) - (a[1].learnedAt || 0));
  return Object.fromEntries(entries.slice(0, MAX_ALIASES));
}

/* Write down what an invoice commit confirmed.

   Batched into one read-modify-write, because a delivery confirms every line at
   once and doing them one at a time over a store with no transactions is how
   entries get lost between reads.

   Re-learning a pairing that already exists bumps its hit count instead of
   rewriting it: that counter is what `trim` keeps the house vocabulary by.
   Re-learning it against a *different* ingredient replaces it outright — a
   person correcting a match is the most reliable signal this table gets, and
   the old pairing is exactly what they were correcting. */
export async function learnAliases(orgId, pairs, { source = "invoice" } = {}) {
  const clean = (pairs || [])
    .map((p) => ({ key: aliasKey(p.text), ingredientId: String(p.ingredientId || "") }))
    .filter((p) => p.key && p.ingredientId);
  if (!clean.length) return { learned: 0 };

  const map = await read(orgId);
  const now = Date.now();
  let learned = 0;

  for (const { key, ingredientId } of clean) {
    const existing = map[key];
    if (existing?.ingredientId === ingredientId) {
      map[key] = { ...existing, hits: (existing.hits || 0) + 1, lastSeenAt: now };
      continue;
    }
    map[key] = {
      ingredientId,
      source,
      hits: 1,
      learnedAt: now,
      lastSeenAt: now,
      /* Kept when a correction replaces a previous pairing, so a table that has
         started matching the wrong thing can be read and understood rather than
         only rebuilt. */
      replaced: existing?.ingredientId || null,
    };
    learned += 1;
  }

  await setJSON(ALIASES(orgId), trim(map));
  return { learned };
}

export async function forgetAlias(orgId, text) {
  const key = aliasKey(text);
  const map = await read(orgId);
  if (!map[key]) return { error: "notfound" };
  delete map[key];
  await setJSON(ALIASES(orgId), map);
  return { ok: true };
}

/* Drop every alias pointing at ingredients that no longer exist.

   Called when an ingredient is deleted and when the store is reset. Without it
   a deleted-then-recreated ingredient inherits the old one's vocabulary, which
   is occasionally what you want and never what you asked for. */
export async function pruneAliases(orgId, known) {
  const map = await read(orgId);
  const next = Object.fromEntries(
    Object.entries(map).filter(([, row]) => known.has(row.ingredientId)));
  const dropped = Object.keys(map).length - Object.keys(next).length;
  if (dropped) await setJSON(ALIASES(orgId), next);
  return { dropped };
}

export async function resetAliases(orgId) {
  await del(ALIASES(orgId));
  return { reset: true };
}
