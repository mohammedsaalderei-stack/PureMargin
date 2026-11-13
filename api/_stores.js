/* The business's stores — its branches — set up by the business itself.

   Branches used to be whatever the connected till said they were. There is no
   other till now, so a business says what its stores are: a name, and the
   address, phone and tax number its receipts print. Everything that scopes by
   branch — permissions, reports, stock, the register — reads this list.

   Every business starts with one store, under the id its first receipts were
   already filed under ("register"), so nothing written before this needs
   moving. A store is archived rather than deleted, because receipts, stock
   ledgers and staff assignments point at its id; and the last open store
   cannot be archived, since a business with no store has nowhere to sell. */

import { getJSON, setJSON, listKeys } from "./_store.js";

const KEY = (orgId) => `org:${orgId}:stores`;
const text = (v, max) => String(v ?? "").trim().slice(0, max);
const slug = (s) => String(s).toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "store";
export const FIRST_STORE_ID = "register";
const MAX_STORES = 50;

function defaults(orgName) {
  return [{ id: FIRST_STORE_ID, name: text(orgName, 60) || "Main store", address: "", phone: "", trn: "", archived: false }];
}

/* A business's first store list, written once.

   Businesses that ran on a connected till already have data filed under that
   till's store ids — a stock ledger per branch, managers assigned to
   branches. Those ids are not in a fresh list, so all of it would have
   dropped out of every screen the day the till went. So the first time the
   list is read, every branch id the business already has data under becomes
   a store of its own, with the same id, under a placeholder name the owner
   can change (a rename keeps the id). Written, so it is worked out once and
   not on every request. */
async function firstList(orgId, orgName) {
  const ids = new Set();
  const prefix = `inv:${orgId}:moves:`;
  for (const key of await listKeys(prefix)) ids.add(key.slice(prefix.length));
  const org = await getJSON(`org:${orgId}`);
  for (const member of Object.values(org?.members || {})) {
    for (const b of member?.branches || []) ids.add(String(b));
  }
  ids.delete(FIRST_STORE_ID);
  ids.delete("");
  const list = [
    ...defaults(orgName),
    ...[...ids].sort().slice(0, MAX_STORES - 1).map((id, i) => ({
      id, name: `Branch ${i + 2}`, address: "", phone: "", trn: "", archived: false,
    })),
  ];
  await setJSON(KEY(orgId), list);
  return list;
}

export async function listStores(orgId, { includeArchived = false, orgName = "" } = {}) {
  const saved = orgId ? await getJSON(KEY(orgId)) : null;
  const list = Array.isArray(saved) && saved.length ? saved : orgId ? await firstList(orgId, orgName) : defaults(orgName);
  return includeArchived ? list : list.filter((s) => !s.archived);
}

export async function saveStore(orgId, input, { orgName = "" } = {}) {
  const name = text(input?.name, 60);
  if (!name) return { error: "name" };
  const list = await listStores(orgId, { includeArchived: true, orgName });
  const existing = input?.id ? list.find((s) => s.id === String(input.id)) : null;
  if (input?.id && !existing) return { error: "notfound" };
  if (!existing && list.length >= MAX_STORES) return { error: "toomany", limit: MAX_STORES };
  const used = new Set(list.map((s) => s.id));
  let id = existing?.id;
  if (!id) {
    id = `s-${slug(name)}`;
    for (let n = 2; used.has(id); n += 1) id = `s-${slug(name)}-${n}`;
  }
  const store = {
    id,
    name,
    address: text(input?.address, 120),
    phone: text(input?.phone, 30),
    trn: text(input?.trn, 20).replace(/\s/g, ""),
    archived: Boolean(existing?.archived),
    /* Which store of a connected till this one is. Not something the form
       edits, so an edit of the name or address must not drop it. */
    ...(existing?.pos ? { pos: existing.pos } : {}),
  };
  const next = existing ? list.map((s) => (s.id === id ? store : s)) : [...list, store];
  await setJSON(KEY(orgId), next);
  return { store, created: !existing };
}

export async function archiveStore(orgId, id, { archived = true, orgName = "" } = {}) {
  const list = await listStores(orgId, { includeArchived: true, orgName });
  const store = list.find((s) => s.id === String(id));
  if (!store) return { error: "notfound" };
  if (archived && list.filter((s) => !s.archived && s.id !== store.id).length === 0) return { error: "last" };
  await setJSON(KEY(orgId), list.map((s) => (s.id === store.id ? { ...s, archived: Boolean(archived) } : s)));
  return { archived: Boolean(archived) };
}

/* Names by id, archived stores included, for reports that cover their past. */
export async function storeNames(orgId, orgName = "") {
  const list = await listStores(orgId, { includeArchived: true, orgName });
  return Object.fromEntries(list.map((s) => [s.id, s.name]));
}

/* ── Stores of a connected till ───────────────────────────────────────────

   A business that connects Loyverse has stores there already, and its sales
   arrive filed under Loyverse's ids for them. Each has to be one of the
   business's own stores, or its sales belong to no branch anybody can see.
   `pos` on a store says which of the till's stores it is.

   In order, for each store the till reports:

   1. A store already carrying that id — the business ran on this till before
      and its stock ledgers are filed under it — is that store. If it still
      has the placeholder name it was given when the till went ("Branch 2"),
      it takes the till's name for it.
   2. Otherwise the business's first store, if it is open and not yet tied to
      anything, is that store. A shop with one store here and one on the till
      has one store, not two; and a new business is allowed one branch, which
      a second store would have used up while leaving its sales locked.
   3. Otherwise it is added, under the till's id and name.

   And one case for a business coming back: when every store the till reports
   was already here by id, the first store was never one of them. If nothing
   has ever happened in it — nothing sold, no stock, nobody assigned, never
   renamed or given an address — it is archived, because standing first in
   the list it would be the one branch a one-branch business is allowed, and
   the stores with the sales in them would be locked behind it. `unused` is
   the caller's word that the register has never sold. Only in the call that
   first ties stores to the till, so one the owner brings back stays. */
const PLACEHOLDER = /^Branch \d+$/;

export async function adoptStores(orgId, found, { orgName = "", unused = false } = {}) {
  const wanted = (Array.isArray(found) ? found : [])
    .map((s) => ({ id: text(s?.id, 80), name: text(s?.name, 60) }))
    .filter((s) => s.id);
  let list = await listStores(orgId, { includeArchived: true, orgName });
  if (!orgId || !wanted.length) return { map: mapOf(list), changed: false };

  let changed = false;
  let tied = 0;
  let linked = false;
  const put = (id, patch) => { list = list.map((s) => (s.id === id ? { ...s, ...patch } : s)); changed = true; };

  /* A different till account from the one these stores were tied to: none of
     its stores is known here. The first store's tie is to a store that is no
     longer being read, so it is let go and can be tied again. */
  const known = wanted.some((w) => list.some((s) => s.id === w.id || s.pos === w.id));
  if (!known && list.some((s) => s.pos && s.pos !== s.id)) {
    list = list.map((s) => {
      if (!s.pos || s.pos === s.id) return s;
      const { pos: _gone, ...rest } = s;
      return rest;
    });
    changed = true;
  }

  for (const w of wanted) {
    const same = list.find((s) => s.id === w.id);
    if (same) {
      const patch = {};
      if (same.pos !== w.id) { patch.pos = w.id; tied += 1; }
      if (w.name && PLACEHOLDER.test(same.name)) patch.name = w.name;
      if (Object.keys(patch).length) put(same.id, patch);
      continue;
    }
    if (list.some((s) => s.pos === w.id)) continue;
    const first = list.find((s) => s.id === FIRST_STORE_ID);
    if (first && !first.archived && !first.pos) {
      /* Still called what it was called when it was made: the till's name
         for the store is the owner's own, typed into Loyverse. */
      const unnamed = first.name === defaults(orgName)[0].name || first.name === "Main store";
      put(first.id, { pos: w.id, ...(unnamed && w.name ? { name: w.name } : {}) });
      tied += 1;
      linked = true;
      continue;
    }
    if (list.length >= MAX_STORES) continue;
    list = [...list, { id: w.id, name: w.name || `Branch ${list.length + 1}`, address: "", phone: "", trn: "", archived: false, pos: w.id }];
    tied += 1;
    changed = true;
  }

  const first = list.find((s) => s.id === FIRST_STORE_ID);
  if (unused && tied && !linked && first && !first.archived && !first.pos && list.some((s) => s.pos && !s.archived)
    && await untouched(orgId, first, orgName)) {
    put(first.id, { archived: true });
  }

  if (changed) await setJSON(KEY(orgId), list);
  return { map: mapOf(list), changed };
}

/* Which of the business's stores each of the till's stores is. */
function mapOf(list) {
  return Object.fromEntries(list.filter((s) => s.pos).map((s) => [s.pos, s.id]));
}

export async function posStoreMap(orgId, orgName = "") {
  return mapOf(await listStores(orgId, { includeArchived: true, orgName }));
}

/* A first store nobody has done anything with. */
async function untouched(orgId, store, orgName) {
  const fresh = defaults(orgName)[0];
  if (store.name !== fresh.name && store.name !== "Main store") return false;
  if (store.address || store.phone || store.trn) return false;
  const ledger = await getJSON(`inv:${orgId}:moves:${store.id}`);
  if (Array.isArray(ledger) ? ledger.length : ledger) return false;
  const org = await getJSON(`org:${orgId}`);
  return !Object.values(org?.members || {}).some((m) => (m?.branches || []).map(String).includes(store.id));
}

