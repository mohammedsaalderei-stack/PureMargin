import { issueToken } from "./_auth.js";
import { createAccount, validUsername, validEmail, passwordProblem, publicAccount } from "./_accounts.js";
import { persistent } from "./_store.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });

  const { username, password, email } = req.body || {};

  if (!validUsername(username)) return res.status(400).json({ error: "username" });
  if (!validEmail(email)) return res.status(400).json({ error: "email" });
  const weak = passwordProblem(password);
  if (weak) return res.status(400).json({ error: weak });

  /* No business name is asked for. It comes from the POS when the account
     connects one, which is a name they've already typed once. */

  try {
    const { account, error } = await createAccount({ username, password, email });
    if (error) return res.status(409).json({ error });

    return res.status(200).json({
      token: issueToken(account.username, account.tokenVersion || 0),
      account: publicAccount(account),
      // The browser shows a warning when accounts aren't durable, rather
      // than letting someone register and quietly lose it.
      persistent,
    });
  } catch (err) {
    console.error("register failed:", err);
    return res.status(500).json({ error: "server" });
  }
}
