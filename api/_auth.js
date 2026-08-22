// Stateless session tokens, signed with HMAC.
// No database needed: the token carries its own expiry and signature.

import crypto from "crypto";

const DAYS = 7;

function secret() {
  return (
    process.env.SESSION_SECRET || "sufra-dev-secret-change-me"
  );
}

function sign(payload) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

/* The version is stamped into the token and checked against the account on
   every request. Bumping it on the account invalidates every token issued
   before — which is what makes "change my password" and "sign out
   everywhere" actually mean something. */
export function issueToken(username, version = 0) {
  const expires = Date.now() + DAYS * 864e5;
  const payload = `${Buffer.from(String(username || "user")).toString("base64url")}.${expires}.${version}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token) {
  if (!token) return null;
  const parts = String(token).split(".");
  if (parts.length !== 4) return null;

  const payload = `${parts[0]}.${parts[1]}.${parts[2]}`;
  const expected = sign(payload);

  const a = Buffer.from(parts[3]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  if (Number(parts[1]) < Date.now()) return null;

  return {
    username: Buffer.from(parts[0], "base64url").toString(),
    version: Number(parts[2]) || 0,
  };
}

/* Returns the session, or writes a 401 and returns null.

   Async, because a valid signature is no longer enough: the token's version
   has to match the account's current one, or a password change wouldn't
   actually end the old sessions. */
export async function requireAuth(req, res) {
  const header = req.headers.authorization || "";
  const session = verifyToken(header.replace(/^Bearer\s+/i, ""));
  if (!session) {
    res.status(401).json({ error: "expired" });
    return null;
  }

  const { getAccount } = await import("./_accounts.js");
  const account = await getAccount(session.username);

  // No account behind the token — deleted, or never existed.
  if (!account) {
    res.status(401).json({ error: "expired" });
    return null;
  }

  if ((account.tokenVersion || 0) !== session.version) {
    res.status(401).json({ error: "revoked" });
    return null;
  }

  return { ...session, account };
}
