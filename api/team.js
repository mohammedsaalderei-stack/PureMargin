/* Organization membership administration.

   Gated on "manage:users", which only the owner role carries. An operations
   manager who could grant permissions could grant themselves the branches they
   aren't assigned, which would make the whole scope model decorative.

   GET    — members, with their role and assigned branches
   POST   — add or update a member: { username, role, branches: [] }
   DELETE — remove a member: ?username=
*/

import { requireAuth } from "./_auth.js";
import { scopeFor, setMember, removeMember, ROLES, ROLE_KEYS } from "./_org.js";
import { getAccount, normalise, posTokenFor } from "./_accounts.js";
import { branchList } from "./_data.js";
import { recordAudit, readAudit } from "./_audit.js";
import { readSyncs } from "./_sync.js";

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  const scope = await scopeFor(session.account);
  if (!scope.capabilities.includes("manage:users")) {
    return res.status(403).json({ error: "forbidden" });
  }
  const org = scope.org;

  /* The branches an assignment may name. Assigning one that doesn't exist is
     rejected outright rather than stored and silently ignored later. */
  let branchIds = [];
  try {
    branchIds = (await branchList(await posTokenFor(session.username))).map((b) => String(b.id));
  } catch {
    branchIds = [];
  }

  if (req.method === "GET") {
    const members = await Promise.all(
      Object.entries(org.members || {}).map(async ([username, m]) => {
        const account = await getAccount(username);
        return {
          username,
          email: account?.email || "",
          role: m.role,
          roleLabel: ROLES[m.role]?.label || m.role,
          scope: ROLES[m.role]?.scope || "assigned",
          branches: m.branches || [],
          since: m.since || null,
          isOwner: username === org.ownerUsername,
          /* An invited username with no account yet still holds its role, so
             the owner can see the seat is waiting rather than lost. */
          pending: !account,
        };
      })
    );

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      organization: { id: org.id, name: org.name, ownerUsername: org.ownerUsername },
      members: members.sort((a, b) => Number(b.isOwner) - Number(a.isOwner)),
      roles: ROLE_KEYS.map((key) => ({ key, label: ROLES[key].label, scope: ROLES[key].scope })),
      availableBranches: branchIds,
      /* Returned with the team rather than from its own endpoint: the audit log
         is only about these changes, and it's the same owner-only gate. */
      audit: await readAudit(org.id, 30),
      /* The sync log rides along too: "when did the POS last answer" is an
         owner's question far more often than a developer's. */
      syncs: await readSyncs(org.id, 20),
    });
  }

  if (req.method === "POST") {
    const { username, role, branches } = req.body || {};
    const id = normalise(username);
    if (!id) return res.status(400).json({ error: "username" });
    if (!ROLE_KEYS.includes(role)) return res.status(400).json({ error: "role" });

    const requested = (branches || []).map(String);
    const unknown = branchIds.length
      ? requested.filter((b) => !branchIds.includes(b))
      : [];
    if (unknown.length) return res.status(400).json({ error: "branch", unknown });

    /* Read before writing, so the log can say whether this created a seat or
       changed an existing one — "role changed" and "added" are different events
       to whoever reads the log later. */
    const before = (org.members || {})[id];

    const { error } = await setMember(org.id, id, { role, branches: requested });
    if (error) return res.status(error === "owner" ? 409 : 400).json({ error });

    await recordAudit(org.id, {
      actor: session.username,
      action: before ? "member.update" : "member.add",
      target: id,
      detail: {
        role,
        branches: requested,
        ...(before ? { fromRole: before.role, fromBranches: before.branches || [] } : {}),
      },
    });
    return res.status(200).json({ ok: true });
  }

  if (req.method === "DELETE") {
    const id = normalise(req.query?.username);
    if (!id) return res.status(400).json({ error: "username" });
    const removed = (org.members || {})[id];
    const { error } = await removeMember(org.id, id);
    if (error) return res.status(error === "owner" ? 409 : 404).json({ error });

    await recordAudit(org.id, {
      actor: session.username,
      action: "member.remove",
      target: id,
      detail: { role: removed?.role || null, branches: removed?.branches || [] },
    });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Use GET, POST, or DELETE." });
}
