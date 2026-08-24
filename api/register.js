import { issueToken } from "./_auth.js";
import { createAccount, validUsername, validEmail, passwordProblem, publicAccount } from "./_accounts.js";
import { persistent } from "./_store.js";
import { orgFor } from "./_org.js";

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

    /* An invitation claims the account for the inviting organization before
       it gets a chance to found its own. The link's token wins; failing
       that, a pending invite against the registered address counts too. */
    const { inviteForToken, inviteForEmail, consumeInvite } = await import("./team.js");
    const { setMember } = await import("./_org.js");
    const { getJSON, setJSON } = await import("./_store.js");
    const invite =
      (await inviteForToken(req.body?.inviteToken)) || (await inviteForEmail(account.email));
    if (invite) {
      const { error: joinError } = await setMember(invite.orgId, account.username, {
        role: invite.role,
        branches: invite.branches || [],
      });
      if (!joinError) {
        const fresh = await getJSON(`acct:${account.username}`);
        if (fresh) {
          fresh.orgId = invite.orgId;
          await setJSON(`acct:${account.username}`, fresh);
        }
        await consumeInvite(invite);
      }
    }

    /* Every account owns an organization from the moment it exists, with
       itself as owner. A single restaurant never has to know the concept, and
       a group grows out of the same record by adding members. */
    if (!invite) await orgFor(account);

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
