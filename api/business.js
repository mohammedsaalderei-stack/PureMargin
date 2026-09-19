/* The business's own settings.

   GET   — type, currency, timezone, features, and the version to send back
   PATCH — { type, expectedVersion }

   ── Why this is a route of its own ───────────────────────────────────────

   `/api/scope` answers "what may this person see", which is derived from a
   session and never written. `/api/account` answers "who is this person".
   Neither is the right home for a property of the *business* that somebody
   edits — and the specification asks for exactly this separation, with an
   optimistic-concurrency version on the write.

   ── Type changes presentation and nothing else ───────────────────────────

   Writing it needs `manage:users`, which is the owner-and-manager capability
   the team screen already uses. That is not because type is dangerous — it
   deletes nothing and grants nothing — but because it rearranges the nav for
   everybody in the organization, and a thing that changes what your colleagues
   see in the morning is not a personal preference.

   Reading it is open to any member. The nav has to draw from it. */

import { requireAuth } from "./_auth.js";
import { scopeFor, setBusinessType } from "./_org.js";
import { posTokenFor } from "./_accounts.js";
import { recordAudit } from "./_audit.js";
import { BUSINESS_TYPES, normaliseType, availableFeatures } from "./_types.js";

/* Proposed defaults in §1, and stated as settings rather than constants
   because that is what they are — a business outside the UAE will need to
   change them, and hard-coding them here would be the first thing in the way.
   They are not yet editable; when they become so, this is where they live. */
const DEFAULT_CURRENCY = "AED";
const DEFAULT_TIMEZONE = "Asia/Dubai";

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  try {
    const scope = await scopeFor(session.account);
    const org = scope.org;
    if (!org) return res.status(403).json({ error: "noorg" });

    /* Whether a till is actually attached, which decides if sales are a real
       module or an empty screen. Failure is not an error here: an account with
       no connection simply has none. */
    let posConnected = false;
    try { posConnected = Boolean(await posTokenFor(session.username)); } catch { /* none */ }

    const body = () => ({
      id: org.id,
      name: org.name || "",
      type: normaliseType(org.type),
      types: BUSINESS_TYPES,
      currency: org.currency || DEFAULT_CURRENCY,
      timezone: org.timezone || DEFAULT_TIMEZONE,
      /* Sent back on every read so a client always has something to put in
         `expectedVersion` without having to remember one. */
      version: Number(org.settingsVersion) || 1,
      availableFeatures: availableFeatures(scope.capabilities, { posConnected }),
      canEdit: scope.capabilities.includes("manage:users"),
    });

    res.setHeader("Cache-Control", "no-store");

    if (req.method === "GET") return res.status(200).json(body());

    if (req.method !== "PATCH" && req.method !== "POST") {
      return res.status(405).json({ error: "Use GET or PATCH." });
    }

    if (!scope.capabilities.includes("manage:users")) {
      return res.status(403).json({ error: "forbidden" });
    }

    const input = req.body || {};
    if (!("type" in input)) return res.status(422).json({ error: "type", field: "type" });

    const out = await setBusinessType(org.id, input.type, {
      expectedVersion: input.expectedVersion,
    });

    if (out.error === "type") return res.status(422).json({ error: "type", field: "type" });
    if (out.error === "conflict") {
      /* 409 with the record as it now stands, so the screen can show what it
         lost to rather than only that it lost. */
      return res.status(409).json({
        error: "conflict", version: out.version, type: out.type,
      });
    }
    if (out.error) return res.status(400).json({ error: out.error });

    await recordAudit(org.id, {
      actor: session.username,
      action: "business.type",
      target: org.id,
      detail: { type: out.type },
    });

    org.type = out.type;
    org.settingsVersion = out.version;
    return res.status(200).json(body());
  } catch (err) {
    console.error("business endpoint failed:", err);
    return res.status(500).json({ error: "server" });
  }
}
