import { getJSON, setJSON } from "./_store.js";
import { normaliseText, words } from "./_text.js";

/* Where a person can clock in, findable without an account.

   ── Why this exists at all ───────────────────────────────────────────────

   Everything else in this app is reached through a session: you sign in, the
   server works out which organization you belong to, and every read is scoped
   to it. Attendance cannot work that way. The person arriving for a shift has
   no account and is never going to have one — that is the whole premise of the
   employee record being separate from the team member. They open the site on
   their own phone and have to be able to say which restaurant they work at
   before anything knows who they are.

   So there has to be one public index. This is it, and it is deliberately the
   only public read in the codebase.

   ── What is in it, and what is kept out ──────────────────────────────────

   A business name and its branch names. That is all.

   Not the staff list: that lives where it already lives, is read per
   organization once a store has been chosen, and is a different call with its
   own limits. Not anything about the business itself — no plan, no owner, no
   till, no figures. An organization's name is what is painted above its door.

   An organization appears here only once somebody with `manage:staff` has
   opened the staff screen, which in practice means only once the business has
   decided to use attendance at all. A customer who never touches the feature
   is never listed, so this is not an index of who pays for the product.

   ── One document, not a scan ─────────────────────────────────────────────

   Search has to work on a string somebody half-remembers, which means reading
   more than one record. Enumerating keys and fetching each would be a lookup
   per organization on an endpoint anyone can call — the cheapest denial of
   service in the building. One small document, read whole, costs the same
   whatever is typed. A name and a handful of branch names is a couple of
   hundred bytes; this stays a single read long past the point where the rest
   of the app has moved to a real database. */

const KEY = "attend:directory";

/* Enough to cover a mistyped word, few enough that a list of businesses
   cannot be walked out of the endpoint a page at a time. */
const MAX_RESULTS = 8;

/* Below this, "a" matches everybody and the search becomes a listing. */
export const MIN_QUERY = 2;

export async function readDirectory() {
  return (await getJSON(KEY)) || {};
}

/* Record a business and its branches as clock-in-able.

   Called from the staff screen's own read, so the index is refreshed by the
   ordinary use of the feature and there is no separate thing to remember to
   run. Writing only on change keeps a screen somebody leaves open all day from
   writing to the store every thirty seconds. */
export async function publishStore(orgId, { name, branches = [], at = Date.now() } = {}) {
  const id = String(orgId || "");
  if (!id) return null;

  const clean = String(name || "").trim().slice(0, 80);
  const rows = branches
    .map((b) => ({ id: String(b.id ?? b), name: String(b.name ?? "").trim().slice(0, 80) }))
    .filter((b) => b.id);

  const dir = await readDirectory();
  const before = dir[id];
  const entry = { name: clean, branches: rows };

  if (before
    && before.name === entry.name
    && JSON.stringify(before.branches) === JSON.stringify(entry.branches)) {
    return before;
  }

  /* `at` is a parameter rather than a call to the clock so that "this write did
     not happen" is testable at all: the staff screen republishes on every read,
     and two publishes in the same millisecond are indistinguishable by a
     timestamp either of them could have produced. */
  dir[id] = { ...entry, at };
  await setJSON(KEY, dir);
  return dir[id];
}

/* Taken off the index — the business stops appearing in the search.

   The employee records and every punch they ever made stay exactly where they
   are. This says "no more clocking in from the open web", not "none of that
   happened". */
export async function unpublishStore(orgId) {
  const dir = await readDirectory();
  if (!dir[String(orgId)]) return false;
  delete dir[String(orgId)];
  await setJSON(KEY, dir);
  return true;
}

export async function getStore(orgId) {
  const dir = await readDirectory();
  const entry = dir[String(orgId || "")];
  return entry ? { id: String(orgId), ...entry } : null;
}

/* Businesses matching what somebody typed.

   Folded through `_text.js`, so the Arabic a cook types on their own phone
   finds the name the owner registered with whichever way either of them spelt
   the alef — the same normalisation that makes a delivery note match the
   shelf. A whole-word or prefix hit ranks above a hit in the middle of a word,
   because "Al" should offer "Al Manara" before "Bab Al Bahr".

   Scoring rather than a plain filter because the list is short and a person
   standing in a doorway should find their own restaurant first. */
export function searchStores(dir, query, { limit = MAX_RESULTS } = {}) {
  const q = normaliseText(query);
  if (q.length < MIN_QUERY) return [];

  const terms = words(query);
  const scored = [];

  for (const [id, entry] of Object.entries(dir || {})) {
    const name = normaliseText(entry?.name);
    if (!name) continue;

    let score = 0;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (name.includes(q)) score = 60;
    else {
      /* Every word typed has to appear somewhere, so "manara cafe" does not
         match a "Manara" that has nothing to do with a cafe. */
      const hay = words(entry.name);
      const all = terms.length > 0 && terms.every((w) => hay.some((h) => h.startsWith(w)));
      if (!all) continue;
      score = 40;
    }

    /* A tie between two names goes to the shorter one: it is the closer match
       to what was typed, not merely the first one the store handed back. */
    scored.push({ score, id, name: entry.name, branches: entry.branches || [] });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.name.length - b.name.length || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({ id, name, branches }) => ({ id, name, branches }));
}
