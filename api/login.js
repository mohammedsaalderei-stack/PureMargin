import { issueToken } from "./_auth.js";
import { verifyPassword, publicAccount, noteLogin } from "./_accounts.js";

/* Sign-in has exactly one path: a stored account whose password hash
   matches. There is no shared-password fallback and no demo mode.

   The previous version issued a token for any unrecognised username when
   APP_PASSWORD wasn't set — which, on a deployment without that variable,
   let anyone in with any credentials at all. */
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });

  const { username = "", email = "", password = "" } = req.body || {};
  const identifier = String(email || username).trim();

  if (!identifier || !password) {
    return res.status(401).json({ error: "credentials" });
  }

  try {
    const account = await verifyPassword(identifier, password);
    if (!account) {
      /* One message for both "no such account" and "wrong password", so the
         response can't be used to work out which addresses are registered. */
      return res.status(401).json({ error: "credentials" });
    }

    /* Use the record noteLogin wrote, not the one read before it —
       otherwise the response carries the previous sign-in time. */
    const updated = (await noteLogin(account.username)) || account;

    return res.status(200).json({
      token: issueToken(updated.username, updated.tokenVersion || 0),
      account: publicAccount(updated),
    });
  } catch (err) {
    console.error("login failed:", err);
    return res.status(500).json({ error: "server" });
  }
}
