/* Organization membership administration.

   Gated on "manage:users", which only the owner role carries. An operations
   manager who could grant permissions could grant themselves the branches they
   aren't assigned, which would make the whole scope model decorative.

   GET    — members, with their role and assigned branches
   POST   — add or update a member: { username, role, branches: [] }
   DELETE — remove a member: ?username=
*/

import crypto from "crypto";
import { requireAuth } from "./_auth.js";
import { scopeFor, setMember, removeMember, ROLES, ROLE_KEYS, saveOrg, can } from "./_org.js";
import { getAccount, normalise, posTokenFor, validEmail, getAccountByEmail } from "./_accounts.js";
import { branchList } from "./_data.js";
import { normaliseGrants, grantable, grantedTabs } from "./_tabs.js";
import { recordAudit, readAudit } from "./_audit.js";
import { readSyncs } from "./_sync.js";
import { getJSON, setJSON, del } from "./_store.js";
import { sendMail } from "./_mail.js";

/* The address invitation links point at.

   Derived from the request headers, an invitation carries whatever host the
   inviter happened to be on — a preview deployment, or the project's
   `*.vercel.app` address — into somebody else's inbox. The link still works,
   but it doesn't look like the product, and a preview URL stops resolving
   once that deployment is rotated away.

   APP_URL pins it. Unset, the old header-derived behaviour stands, so a
   deployment that hasn't configured it still sends a working link. */
function publicOrigin(req) {
  const configured = String(process.env.APP_URL || "").trim().replace(/\/+$/, "");
  if (configured) return /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
  const host = req.headers.host;
  return host ? `https://${host}` : "";
}

/* ── Email invitations ────────────────────────────────────────

   The owner types an address and a role; the person gets a sign-up link and
   the seat is waiting when they register. The invite is stored twice — by
   token (what the link carries) and by address (what registration checks),
   plus a per-org list so the Team screen can show who hasn't accepted yet. */
const INVITE_TOKEN_KEY = (token) => `teaminvite:${token}`;
const INVITE_EMAIL_KEY = (email) => `teaminvite-email:${String(email).trim().toLowerCase()}`;
const ORG_INVITES_KEY = (orgId) => `teaminvites:${orgId}`;

export async function inviteForEmail(email) {
  const token = await getJSON(INVITE_EMAIL_KEY(email));
  return token ? getJSON(INVITE_TOKEN_KEY(token)) : null;
}

export async function inviteForToken(token) {
  return token ? getJSON(INVITE_TOKEN_KEY(String(token))) : null;
}

export async function consumeInvite(invite) {
  if (!invite?.token) return;
  const list = ((await getJSON(ORG_INVITES_KEY(invite.orgId))) || []).filter((i) => i.token !== invite.token);
  await setJSON(ORG_INVITES_KEY(invite.orgId), list);
  await del(INVITE_TOKEN_KEY(invite.token));
  await del(INVITE_EMAIL_KEY(invite.email));
}

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
          extraTabs: grantedTabs(org, username, m.role),
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
      /* Addresses invited but not yet registered. */
      invites: (await getJSON(ORG_INVITES_KEY(org.id))) || [],
      roles: ROLE_KEYS.map((key) => ({ key, label: ROLES[key].label, scope: ROLES[key].scope })),
      availableBranches: branchIds,
      /* The extra-access panel needs both halves: what may be handed out, and
         what already has been. Sent with the team rather than from a second
         endpoint, because it is only ever read on this screen. */
      grantableTabs: grantable(),
      grants: normaliseGrants(org.tabGrants || {}),
      /* Returned with the team rather than from its own endpoint: the audit log
         is only about these changes, and it's the same owner-only gate. */
      audit: await readAudit(org.id, 30),
      /* The sync log rides along too: "when did the POS last answer" is an
         owner's question far more often than a developer's. */
      syncs: await readSyncs(org.id, 20),
    });
  }

  if (req.method === "POST") {
    const { username, email, role, branches } = req.body || {};

    /* The email path: invite someone who may not have an account yet. */
    if (!username && email) {
      if (!validEmail(email)) return res.status(400).json({ error: "email" });
      if (!ROLE_KEYS.includes(role)) return res.status(400).json({ error: "role" });

      /* A branch-scoped role with no branches sees nothing at all.

         It used to be accepted, which produced the worst kind of member: they
         sign in, every screen is empty, and there is nothing on it explaining
         why. The owner meanwhile has a full member list and no reason to
         suspect anything. Refused at the door instead, where the person who
         made the omission is still looking at the form.

         Only roles scoped to assigned branches are checked. An owner or an
         accountant covers the whole business by definition, and demanding a
         branch for them would be inventing a restriction the role does not
         have. */
      if (ROLES[role]?.scope === "assigned" && !(branches || []).length) {
        return res.status(400).json({ error: "nobranch" });
      }

      const address = String(email).trim().toLowerCase();

      /* Someone already registered with this address just gets the seat —
         no email round-trip needed. */
      const existing = await getAccountByEmail(address);
      if (existing) {
        const requested = (branches || []).map(String);
        const { error } = await setMember(org.id, existing.username, { role, branches: requested });
        if (error) return res.status(error === "owner" ? 409 : 400).json({ error });
        /* Their account may have been running its own empty org; point it here. */
        existing.orgId = org.id;
        await setJSON(`acct:${normalise(existing.username)}`, existing);
        await recordAudit(org.id, {
          actor: session.username, action: "member.add", target: existing.username,
          detail: { role, branches: requested, viaEmail: address },
        });
        return res.status(200).json({ ok: true, joined: existing.username });
      }

      const token = crypto.randomBytes(24).toString("base64url");
      const invite = {
        token, orgId: org.id, email: address,
        role, branches: (branches || []).map(String),
        invitedBy: session.username, at: Date.now(),
      };
      await setJSON(INVITE_TOKEN_KEY(token), invite);
      await setJSON(INVITE_EMAIL_KEY(address), token);
      const list = ((await getJSON(ORG_INVITES_KEY(org.id))) || []).filter((i) => i.email !== address);
      list.push({ token, email: address, role, at: invite.at });
      await setJSON(ORG_INVITES_KEY(org.id), list);

      const origin = publicOrigin(req);
      const link = `${origin}/?invite=${token}`;
      const orgName = org.name || session.username;

      /* The seat is already written. If the mail fails the invitation is still
         real and still waiting, so failing the request would be a lie in the
         other direction — and worse, the owner retries, a second token is
         issued, and the first one is orphaned.

         Before this, a throw from sendMail escaped to the outer handler and
         came back as a 500, which the screen rendered as "Couldn't load the
         team." An owner reading that has no way to know the person was in fact
         invited, so they try again, and again. Now the failure is reported as
         what it is: invited, not emailed, here is the link to send them. */
      let mailed = false;
      try {
        await sendMail({
          to: address,
          subject: `You've been invited to ${orgName} on PureMargin`,
          text: `${session.username} invited you to join ${orgName} on PureMargin as ${ROLES[role]?.label || role}.\n\nCreate your account here: ${link}\n\nAny packages the team owns apply to you automatically.`,
          html: `<p><strong>${session.username}</strong> invited you to join <strong>${orgName}</strong> on PureMargin as <strong>${ROLES[role]?.label || role}</strong>.</p><p><a href="${link}">Create your account</a> to accept. Any packages the team owns apply to you automatically.</p>`,
        });
        mailed = true;
      } catch (err) {
        console.error("invitation mail failed:", err?.message || err);
      }

      await recordAudit(org.id, {
        actor: session.username, action: "member.invite", target: address,
        detail: { role, branches: invite.branches, mailed },
      });

      return res.status(200).json({ ok: true, invited: address, mailed, link });
    }

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

  /* Opening a tab somebody's role does not normally include.

     PATCH { roles: { chef: ["variance"] }, users: { fatima: ["watch"] } }

     The whole map is replaced rather than merged, so removing a grant is
     sending it without that entry — a merge-only endpoint gives no way to take
     something back except a second verb nobody remembers exists.

     Team and Packages cannot be granted. They are controls, not views: Team
     lets somebody change roles, which lets them grant themselves everything
     else. An owner who wants a second administrator has a way to say so, and
     that decision should look like what it is. */
  if (req.method === "PATCH") {
    if (!can(member.role, "manage:users")) return res.status(403).json({ error: "forbidden" });

    const grants = normaliseGrants(req.body || {});
    const org2 = { ...org, tabGrants: grants };
    await saveOrg(org2);

    await recordAudit(org.id, {
      actor: session.username,
      action: "tabs.grant",
      detail: grants,
    });

    return res.status(200).json({ grants, grantable: grantable() });
  }

  if (req.method === "DELETE") {
    /* Withdrawing an unaccepted email invitation. */
    if (req.query?.email) {
      const invite = await inviteForEmail(req.query.email);
      if (!invite || invite.orgId !== org.id) return res.status(404).json({ error: "noinvite" });
      await consumeInvite(invite);
      await recordAudit(org.id, {
        actor: session.username, action: "member.uninvite", target: invite.email,
      });
      return res.status(200).json({ ok: true });
    }

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
