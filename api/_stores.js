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

import { getJSON, setJSON } from "./_store.js";

const KEY = (orgId) => `org:${orgId}:stores`;
const text = (v, max) => String(v ?? "").trim().slice(0, max);
const slug = (s) => String(s).toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "store";
export const FIRST_STORE_ID = "register";
const MAX_STORES = 50;

function defaults(orgName) {
  return [{ id: FIRST_STORE_ID, name: text(orgName, 60) || "Main store", address: "", phone: "", trn: "", archived: false }];
}

export async function listStores(orgId, { includeArchived = false, orgName = "" } = {}) {
  const saved = orgId ? await getJSON(KEY(orgId)) : null;
  const list = Array.isArray(saved) && saved.length ? saved : defaults(orgName);
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
