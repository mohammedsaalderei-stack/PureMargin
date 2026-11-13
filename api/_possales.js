/* A business's sales from its connected till, ready to sit beside the
   register's.

   `_loyverse.js` knows Loyverse; this knows the business. It finds the token
   (`posTokenForOrg`), reads, makes sure each of the till's stores is one of
   the business's own (`adoptStores`) and files every receipt under that
   store's id, and writes the sync log a person reads to see when the till was
   last read and whether it worked.

   It never throws for the till's sake. A Loyverse that cannot be read is a
   reason to show the register's sales with a note saying the till's are
   missing — not a reason to show nothing — so a failure comes back as
   `status.ok === false` with the reason. */

import { loyverseSales, LoyverseError, PROVIDER } from "./_loyverse.js";
import { posTokenForOrg } from "./_accounts.js";
import { adoptStores } from "./_stores.js";
import { noteSync } from "./_sync.js";

/* What was last written to each business's sync log, so an outage is one
   line and the recovery another, not a line for every screen that asked in
   between. In-process only: a second server instance writing the same line
   again is harmless. */
const logged = new Map();
const RELOG_MS = 10 * 60 * 1000;

async function note(orgId, entry, now) {
  const last = logged.get(orgId);
  const same = last && last.ok === entry.ok && last.error === (entry.error || null);
  if (!entry.ok && same && now - last.at < RELOG_MS) return;
  if (entry.ok && !entry.full && (!last || last.ok)) return;
  logged.set(orgId, { ok: entry.ok, error: entry.error || null, at: now });
  const { full: _full, ...rest } = entry;
  await noteSync(orgId, { source: PROVIDER, ...rest });
}

/* For tests. */
export function __forgetSyncNotes() { logged.clear(); }

export async function posSalesFor(org, { days = 62, unused = false, now = Date.now() } = {}) {
  if (!org?.id) return { receipts: [], status: null };
  const { token, via, unreadable } = await posTokenForOrg(org);
  if (!token) {
    return {
      receipts: [],
      /* Connected once, and the key can no longer be read — the server's
         secret changed. Said, so the owner is asked to connect again rather
         than left wondering where the sales went. */
      status: unreadable ? { provider: "loyverse", connected: false, lost: true } : null,
    };
  }

  let got;
  try {
    got = await loyverseSales(token, { days, now });
  } catch (err) {
    const code = err instanceof LoyverseError ? err.code : "upstream";
    if (!err?.remembered) await note(org.id, { ok: false, error: code }, now);
    return { receipts: [], status: { provider: "loyverse", connected: true, ok: false, error: code, via } };
  }

  /* Stores first: a receipt filed under a store the business does not have
     belongs to a branch nobody can select. */
  let map = {};
  try {
    ({ map } = await adoptStores(org.id, got.stores, { orgName: org.name, unused }));
  } catch (err) {
    /* The store list could not be written. The sales are still the sales;
       filed under the till's own ids they show as unnamed branches until the
       next read manages it. */
    console.error("adopting the till's stores failed:", err?.message || err);
  }
  const receipts = got.receipts.map((r) => (map[r.store_id] ? { ...r, store_id: map[r.store_id] } : r));

  if (got.wentUpstream) {
    await note(org.id, got.error
      ? { ok: false, error: got.error.code }
      : {
        ok: true,
        full: got.full,
        receipts: got.receipts.length,
        branches: new Set(receipts.map((r) => r.store_id)).size,
        limitedHistory: got.limitedHistory,
        truncated: got.truncated,
      }, now);
  }

  const first = receipts.length ? new Date(receipts[0].receipt_date).getTime() : null;
  return {
    receipts,
    firstAt: first,
    status: {
      provider: "loyverse",
      connected: true,
      ok: !got.error,
      error: got.error?.code || null,
      via,
      fetchedAt: got.fetchedAt,
      limitedHistory: got.limitedHistory,
      truncated: got.truncated,
      historyDays: got.historyDays,
      receipts: receipts.length,
    },
  };
}
