/* What the signed-in user is allowed to see.

   The interface needs this to draw the scope selector (all branches, a group,
   or one branch) and to decide which sections to offer at all. It is advisory
   for the interface and authoritative nowhere: every endpoint re-derives the
   same scope from the session, so a client that ignores this response gains
   nothing. */

import { requireAuth } from "./_auth.js";
import { scopeFor, ROLES } from "./_org.js";
import { allowedTabs } from "./_tabs.js";
import { posTokenFor } from "./_accounts.js";
import { branchList } from "./_data.js";

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  try {
    /* Branches come from the POS, so an account with no connection simply has
       none yet — not an error. */
    let branches = [];
    try {
      const posToken = await posTokenFor(session.username);
      branches = await branchList(posToken);
    } catch {
      branches = [];
    }

    const scope = await scopeFor(session.account, branches.map((b) => b.id));
    const allowed = new Set(scope.authorized);

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      role: scope.role,
      roleLabel: scope.role ? ROLES[scope.role].label : null,
      isOwner: scope.isOwner,
      capabilities: scope.capabilities,
      /* The definitive list of tabs this person may open, resolved from the
         same capabilities the data routes check. The browser renders this
         rather than deciding for itself, so the nav and the API can never
         disagree about what exists. */
      tabs: allowedTabs(scope.capabilities),
      organization: scope.org ? { id: scope.org.id, name: scope.org.name } : null,
      /* Only the branches this user may see. The ones they may not are absent
         rather than marked — a disabled entry still discloses that a branch
         exists and what it's called. */
      branches: branches.filter((b) => allowed.has(String(b.id))),
    });
  } catch (err) {
    console.error("scope failed:", err);
    return res.status(500).json({ error: "server" });
  }
}
