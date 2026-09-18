import crypto from "node:crypto";
import { getJSON, setJSON, del } from "./_store.js";

/* The key in the clock-in link, and what it replaced.

   ── There was a public directory here ────────────────────────────────────

   The first version of attendance let anybody search every business using the
   feature by name, then read that business's staff list. It was the only
   public read in the codebase and it bought exactly one thing: somebody
   arriving for a shift could find their restaurant without being given
   anything first.

   That was a bad trade. It meant a stranger could learn who works where, and
   the search had to exist for a person who is handed a link by their manager
   on their first day anyway. The premise — that the arriving person has no
   account and never will — is still true. What was wrong was concluding from
   it that the endpoint had to be open to everyone.

   ── What the key is, and what it honestly is not ─────────────────────────

   An unguessable string that resolves to exactly one organization. The same
   shape as the POS webhook token in `_loyversehook.js`, for the same reason:
   the URL is the authentication, because the thing at the other end of it
   cannot hold a session.

   It is a bearer credential. Whoever has the link can see that business's
   branches and staff names and can record a punch. That is a much smaller
   population than "the internet", and it is the population who work there —
   but it will end up in a staff WhatsApp group, and somebody who leaves keeps
   it until it is rotated. Rotation is the answer to a person leaving, and it
   is one button.

   ── Why the branch and staff snapshot lives on the key record ────────────

   Branch names come from the till, which needs the owner's credentials, so
   the clock-in page cannot fetch them itself. They are written here whenever
   somebody with `manage:staff` opens the staff screen — the ordinary use of
   the feature keeps them current, with nothing separate to remember to run.

   Kept on the key record rather than under the org id so the public path is a
   single read: one lookup answers "which business, which branches", and there
   is no second key an attacker could address by guessing an org id. */

const CURRENT = (orgId) => `clockkey:org:${orgId}`;
const RESOLVE = (key) => `clockkey:key:${key}`;

/* Twenty-four random bytes. Long enough that guessing is not a strategy, and
   URL-safe so it survives being pasted into a message, printed on a card, or
   turned into a QR code. */
const newKey = () => crypto.randomBytes(24).toString("base64url");

/* A cost guard, not the security boundary.

   The boundary is the lookup: a key that was never issued does not resolve,
   whatever it looks like. What this buys is that a flood of junk at the open
   endpoint costs a regex each rather than a round trip to the store — and it
   is worth saying which of the two is doing the work, because a reader who
   believes this line is the check might later "simplify" the lookup away. */
const SHAPE = /^[A-Za-z0-9_-]{16,64}$/;

/* The organization's key, created on first use.

   Returned rather than shown once. This is an address, not a password: the
   manager who set it up in March has to be able to read it back in June to
   give it to a new hire, and a key that could only ever be seen once would be
   rotated every time somebody joined — which would break it for everyone else
   on the rota. */
export async function clockKey(orgId) {
  if (!orgId) return null;
  const existing = await getJSON(CURRENT(orgId));
  if (existing?.key) return existing.key;

  const key = newKey();
  await setJSON(CURRENT(orgId), { key, createdAt: Date.now() });
  await setJSON(RESOLVE(key), { orgId: String(orgId), createdAt: Date.now() });
  return key;
}

/* Replace the key, and retire the old one in the same breath.

   The old mapping is deleted rather than left to lapse: a rotation happens
   because somebody left or the link got out, and a link that still works for
   another hour has not been rotated.

   The branch snapshot is carried across, so the first person to use the new
   link is not met with an empty list waiting for a manager to open the staff
   screen. */
export async function rotateClockKey(orgId) {
  if (!orgId) return null;
  const existing = await getJSON(CURRENT(orgId));

  let carried = null;
  if (existing?.key) {
    const old = await getJSON(RESOLVE(existing.key));
    if (old) carried = { name: old.name, branches: old.branches };
    await del(RESOLVE(existing.key));
  }
  await del(CURRENT(orgId));

  const key = await clockKey(orgId);
  if (carried?.name !== undefined || carried?.branches !== undefined) {
    await publishClockIn(orgId, carried);
  }
  return key;
}

/* Which business a link belongs to, and what its clock-in page should show.

   One read. Returns null for a key that is the wrong shape, a key that was
   rotated away, and a key that never existed — the caller has no way to tell
   those apart and no reason to, and neither does whoever is holding the link. */
export async function resolveClockKey(key) {
  const clean = String(key || "").trim();
  if (!SHAPE.test(clean)) return null;

  const found = await getJSON(RESOLVE(clean));
  if (!found?.orgId) return null;

  return {
    orgId: String(found.orgId),
    name: found.name || "",
    branches: Array.isArray(found.branches) ? found.branches : [],
  };
}

/* Refresh what the clock-in page shows for this business.

   Written only when something changed, so a staff screen somebody leaves open
   all day does not write to the store every thirty seconds. */
export async function publishClockIn(orgId, { name, branches = [] } = {}) {
  if (!orgId) return null;
  const key = await clockKey(orgId);
  const record = (await getJSON(RESOLVE(key))) || { orgId: String(orgId) };

  const clean = String(name || "").trim().slice(0, 80);
  const rows = branches
    .map((b) => ({ id: String(b.id ?? b), name: String(b.name ?? "").trim().slice(0, 80) }))
    .filter((b) => b.id);

  if (record.name === clean && JSON.stringify(record.branches) === JSON.stringify(rows)) {
    return record;
  }

  const next = { ...record, orgId: String(orgId), name: clean, branches: rows, at: Date.now() };
  await setJSON(RESOLVE(key), next);
  return next;
}
