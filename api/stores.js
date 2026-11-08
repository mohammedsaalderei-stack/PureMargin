/* The business's stores.

   GET   — the stores (archived ones too, for whoever manages them)
   POST  — { id?, name, address, phone, trn }: add a store, or amend one
   PATCH — { id, archived }: archive or restore

   Reading is open to anyone in the organization, since every screen that
   scopes by branch needs the names. Changing them is the owner's
   (`manage:users`): adding a store changes who can see what, because
   branch-scoped roles are assigned against these ids. */

import { requireAuth } from "./_auth.js";
import { scopeFor, lockedBranches } from "./_org.js";
import { listStores, saveStore, archiveStore } from "./_stores.js";
import { recordAudit } from "./_audit.js";

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  try {
    const scope = await scopeFor(session.account);
    const org = scope.org;
    if (!org?.id) return res.status(403).json({ error: "noorg" });
    const canManage = scope.capabilities.includes("manage:users");
    const orgName = org.name || session.account.business || "";
    res.setHeader("Cache-Control", "no-store");

    if (req.method === "GET") {
      const stores = await listStores(org.id, { includeArchived: canManage, orgName });
      /* Stores past what the plan covers exist but cannot be used until an
         extra branch is added to the plan; said here so the owner is not left
         wondering why a store they made is missing from the register. */
      const open = stores.filter((s) => !s.archived).map((s) => s.id);
      return res.status(200).json({
        stores,
        canManage,
        locked: lockedBranches(org, open),
        allowance: org.branchAllowance ?? null,
      });
    }

    if (!canManage) return res.status(403).json({ error: "forbidden" });
    const audit = (action, detail, target) =>
      recordAudit(org.id, { actor: session.username, action, target, detail });

    if (req.method === "POST") {
      const out = await saveStore(org.id, req.body || {}, { orgName });
      if (out.error) return res.status(out.error === "notfound" ? 404 : 400).json(out);
      await audit("store.save", { name: out.store.name, created: out.created }, out.store.id);
      return res.status(out.created ? 201 : 200).json(out);
    }

    if (req.method === "PATCH") {
      const { id, archived = true } = req.body || {};
      const out = await archiveStore(org.id, id, { archived, orgName });
      if (out.error) return res.status(out.error === "notfound" ? 404 : 409).json(out);
      await audit("store.archive", { archived: out.archived }, String(id));
      return res.status(200).json(out);
    }

    return res.status(405).json({ error: "Use GET, POST or PATCH." });
  } catch (err) {
    console.error("stores endpoint failed:", err);
    return res.status(500).json({ error: "server" });
  }
}
