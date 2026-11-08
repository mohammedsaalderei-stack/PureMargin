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

/* A signature for something that is not a session — the register's operator
   token, say — under its own label, so a value signed for one purpose can
   never be replayed as another. */
export function signScoped(label, payload) {
  return crypto.createHmac("sha256", `${secret()}:${label}`).update(payload).digest("base64url");
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

/* A register-only device: a till handed to staff.

   Issued by somebody signed in properly, for their own account, and good for
   the register's route and nothing else (`REGISTER_ONLY_ROUTES`). Signed under
   its own label so it can never be passed off as a session, and stamped with
   the account's token version like a session is, so "sign out everywhere"
   ends the device too. A year, because a till on a counter should not ask
   for the owner's password every week. */
const DEVICE_DAYS = 365;
export const REGISTER_ONLY_ROUTES = ["till"];

export function issueDeviceToken(username, version = 0) {
  const expires = Date.now() + DEVICE_DAYS * 864e5;
  const payload = `R.${Buffer.from(String(username || "user")).toString("base64url")}.${expires}.${version}`;
  return `${payload}.${signScoped("device", payload)}`;
}

function verifyDeviceToken(token) {
  const parts = String(token).split(".");
  if (parts.length !== 5 || parts[0] !== "R") return null;
  const payload = parts.slice(0, 4).join(".");
  const a = Buffer.from(parts[4]);
  const b = Buffer.from(signScoped("device", payload));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(parts[2]) < Date.now()) return null;
  return {
    username: Buffer.from(parts[1], "base64url").toString(),
    version: Number(parts[3]) || 0,
    registerOnly: true,
  };
}

/* Which API route a request is for: `/api/till?…` → "till". */
function routeOf(req) {
  const path = String(req.url || "").split("?")[0];
  return path.match(/\/api\/([a-z0-9_-]+)\/?$/)?.[1] || "";
}

export function verifyToken(token) {
  if (!token) return null;
  if (String(token).startsWith("R.")) return verifyDeviceToken(token);
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
  const { handledUnavailable } = await import("./_store.js");

  /* A 401 here was a lie worth money. `getAccount` returning null means "no
     such account", and a store that could not be reached returned the same
     null — so when the database went away every signed-in user was told
     their session had expired, and the owner's reasonable conclusion was
     that their password had stopped working rather than that the data was
     gone. Which invites re-registering, writing fresh records over the top
     of the real ones the moment the store comes back. */
  let account;
  try {
    account = await getAccount(session.username);
  } catch (err) {
    if (handledUnavailable(res, err)) return null;
    throw err;
  }

  // No account behind the token — deleted, or never existed.
  if (!account) {
    res.status(401).json({ error: "expired" });
    return null;
  }

  if ((account.tokenVersion || 0) !== session.version) {
    res.status(401).json({ error: "revoked" });
    return null;
  }

  /* A register-only device reaches the register and nothing else — not the
     dashboard, the costs or the team, whatever the account behind it could
     see. Checked here rather than in each route, so a route added later is
     closed to it without anybody remembering to close it. */
  if (session.registerOnly && !REGISTER_ONLY_ROUTES.includes(routeOf(req))) {
    res.status(403).json({ error: "registeronly" });
    return null;
  }

  return { ...session, account };
}
