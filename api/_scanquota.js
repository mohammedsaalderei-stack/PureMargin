import { getJSON, setJSON } from "./_store.js";
import { SCAN_LIMIT_PER_MONTH } from "./_accounts.js";

/* How many photographs an organization may send this month.

   Every scan is a vision-model call, which is the one cost in this product
   that scales with use rather than with accounts. Left uncapped, a retry loop
   on a bad connection runs it up overnight and the first anyone knows is the
   invoice.

   Counted per organization rather than per person, because the bill belongs to
   the business and a cap a cashier could reset by signing in as somebody else
   would not be a cap. Counted per calendar month rather than a rolling thirty
   days, because "you have 12 scans left until the 1st" is a sentence somebody
   can act on and "until some point in the next four weeks" is not.

   The key carries the month, so an expired period needs no sweeping: next
   month reads a key that does not exist yet and starts at zero. */

const KEY = (orgId, period) => `scans:${orgId}:${period}`;

export function periodOf(at = Date.now()) {
  const d = new Date(at);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/* When the current allowance resets, so the interface can name a date rather
   than say "later". */
export function resetsAt(at = Date.now()) {
  const d = new Date(at);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

export async function scanUsage(orgId, at = Date.now()) {
  if (!orgId) return { used: 0, limit: SCAN_LIMIT_PER_MONTH, left: SCAN_LIMIT_PER_MONTH, resetsAt: resetsAt(at) };
  const record = await getJSON(KEY(orgId, periodOf(at)));
  const used = record?.used || 0;
  return {
    used,
    limit: SCAN_LIMIT_PER_MONTH,
    left: Math.max(0, SCAN_LIMIT_PER_MONTH - used),
    resetsAt: resetsAt(at),
  };
}

/* Claim one scan before the model is called, not after.

   Counting on the way out would let a burst of parallel requests all pass the
   check and then all succeed, and it would also give away free scans whenever
   the model errored — which is exactly when something is retrying hardest. */
export async function claimScan(orgId, at = Date.now()) {
  const usage = await scanUsage(orgId, at);
  if (usage.left <= 0) return { allowed: false, ...usage };
  const next = usage.used + 1;
  await setJSON(KEY(orgId, periodOf(at)), { used: next, at });
  return {
    allowed: true,
    used: next,
    limit: usage.limit,
    left: Math.max(0, usage.limit - next),
    resetsAt: usage.resetsAt,
  };
}

/* Give a claimed scan back when the model never ran — an unreachable API, a
   refused key. The person got nothing, so charging them a scan for it would be
   a quiet tax on our own outages. A scan the model answered badly is not
   refunded: it was spent, and the correction path exists for that. */
export async function refundScan(orgId, at = Date.now()) {
  if (!orgId) return;
  const key = KEY(orgId, periodOf(at));
  const record = await getJSON(key);
  if (!record?.used) return;
  await setJSON(key, { used: Math.max(0, record.used - 1), at });
}
