/* Sync log — every time the app actually went to the POS, and what came back.

   The dashboard polls, but almost every poll is served from cache; only a real
   upstream read is recorded, otherwise the log would say "synced" every thirty
   seconds and mean nothing. A failure is recorded too, with the reason — the
   useful question is usually "when did this last work", and a log that only
   holds successes cannot answer it.

   This is what turns "updated 12 seconds ago" into something checkable: the age
   on screen is the cache age, and this says when the figures behind it were
   genuinely fetched, over what period, and how many receipts it saw. */

import { append, recent } from "./_journal.js";

const KEY = (orgId) => `sync:${orgId}`;

export async function noteSync(orgId, entry) {
  if (!orgId) return null;
  try {
    return await append(KEY(orgId), entry);
  } catch (err) {
    // A sync that succeeded but couldn't be logged is still a sync.
    console.error("sync log write failed:", err.message);
    return null;
  }
}

export async function readSyncs(orgId, limit = 20) {
  if (!orgId) return [];
  return recent(KEY(orgId), limit);
}

export async function lastSync(orgId, { ok = null } = {}) {
  const list = await readSyncs(orgId, 50);
  if (ok === null) return list[0] || null;
  return list.find((s) => Boolean(s.ok) === ok) || null;
}
