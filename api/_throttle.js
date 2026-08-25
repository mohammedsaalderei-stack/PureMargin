import { getJSON, setJSON, del } from "./_store.js";

/* Sign-in throttling.

   Before this, /api/login accepted password guesses at whatever rate a client
   could send them. The reset flow already caps attempts and the admin panel
   already pauses on a bad password, but the front door — the one that hands
   out a session token — did neither, so an ordinary account password was only
   as strong as the time an attacker was willing to spend.

   The store has no TTL, so the window is carried in the record and checked on
   read, the same way reset.js handles code expiry.

   Counting is per identifier, not per IP. An attacker spraying one password
   across many accounts is a different problem and wants different handling;
   this stops the case that actually breaks a single account, and it cannot be
   sidestepped by changing address. The cost is that somebody who knows your
   email can lock you out of it for the window, which is why the window is
   fifteen minutes rather than a day, and why nothing here is permanent. */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;

/* Long enough to make an online guessing run tedious, short enough that a
   person who fat-fingered their own password doesn't think it hung. */
const FAILURE_DELAY_MS = 400;

const KEY = (id) => `login:fail:${String(id).trim().toLowerCase()}`;

export const LOCKOUT_WINDOW_MS = WINDOW_MS;
export const LOCKOUT_MAX_FAILURES = MAX_FAILURES;

/* Whether this identifier is currently locked out, and for how much longer.
   Reads clear their own expired records so a stale one can't accumulate. */
export async function lockState(identifier, now = Date.now()) {
  if (!identifier) return { locked: false, failures: 0, retryInMs: 0 };
  const key = KEY(identifier);
  const record = await getJSON(key);
  if (!record) return { locked: false, failures: 0, retryInMs: 0 };

  if (!record.until || record.until <= now) {
    await del(key);
    return { locked: false, failures: 0, retryInMs: 0 };
  }

  const failures = record.failures || 0;
  return {
    locked: failures >= MAX_FAILURES,
    failures,
    retryInMs: Math.max(0, record.until - now),
  };
}

/* Record a failed attempt. The window is measured from the first failure in a
   run, not extended by each new one — otherwise a slow trickle of guesses
   keeps somebody locked out indefinitely. */
export async function noteFailure(identifier, now = Date.now()) {
  if (!identifier) return { locked: false, failures: 0, retryInMs: 0 };
  const key = KEY(identifier);
  const existing = await getJSON(key);
  const live = existing && existing.until > now ? existing : null;

  const failures = (live ? live.failures || 0 : 0) + 1;
  const until = live ? live.until : now + WINDOW_MS;
  await setJSON(key, { failures, until });

  return {
    locked: failures >= MAX_FAILURES,
    failures,
    retryInMs: Math.max(0, until - now),
  };
}

/* A correct password ends the run, so a person who mistyped twice and then got
   it right starts clean next time. */
export async function clearFailures(identifier) {
  if (!identifier) return;
  await del(KEY(identifier));
}

export function retryAfterSeconds(retryInMs) {
  return Math.max(1, Math.ceil(retryInMs / 1000));
}

export function pause(ms = FAILURE_DELAY_MS) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
