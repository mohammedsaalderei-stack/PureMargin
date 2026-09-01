import { requireAuth } from "./_auth.js";
import { getAccount, posTokenFor } from "./_accounts.js";
import { orgFor, membership, ROLES, can } from "./_org.js";
import { branchList } from "./_data.js";
import { recordAudit } from "./_audit.js";
import { sendMail, shell, quote, row } from "./_mail.js";
import {
  listMessages, postMessage, markRead, lastReadAt, recipientsFor,
  matchesAudience, audienceIsEveryone, addressable, visibleTo, isDirect,
  MAX_BODY,
} from "./_messages.js";

/* The team board.

   GET  — the messages this member can see, plus who they can address
   POST — write one; { body, important, branches: [], roles: [] }
   PUT  — mark the board read up to now

   Marking a message important is limited to `manage:users`, which in practice
   means the owner. Important is not a formatting choice: it mails people. If
   everyone could reach everyone's inbox, the flag would be worth nothing
   within a week, and the people it is meant to reach would start ignoring it. */

function publicMessage(message, member, username) {
  return {
    ...message,
    forMe: matchesAudience(message.audience, member, username),
    everyone: audienceIsEveryone(message.audience),
    direct: isDirect(message),
  };
}

/* An important message names its audience in the subject, because somebody
   scanning a phone inbox decides whether to open it from that line alone. */
/* The audience in words, shared by the subject line and the body so the two
   can never describe different recipients for the same message. */
function subjectAudience(audience, branchNames) {
  const parts = [];
  if (audience.branches.length) {
    parts.push(audience.branches.map((id) => branchNames[id] || id).join(", "));
  }
  if (audience.roles.length) {
    parts.push(audience.roles.map((r) => ROLES[r]?.label || r).join(", "));
  }
  return parts.length ? parts.join(" · ") : "Everyone";
}

function subjectFor(orgName, audience, branchNames, author) {
  /* A personal message says who it is from; that is what makes somebody open
     it. A broadcast says who it is for, because that is what makes somebody
     decide whether it concerns them. */
  if (audience.users?.length) return `[${orgName}] ${author} sent you a message`;
  const who = subjectAudience(audience, branchNames);
  return `[${orgName}] Important — ${who}`;
}

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  const account = await getAccount(session.username);
  if (!account) return res.status(401).json({ error: "auth" });

  const org = await orgFor(account);
  if (!org) return res.status(403).json({ error: "noorg" });

  const member = membership(org, account.username);
  if (!member) return res.status(403).json({ error: "nomember" });

  const mayFlag = can(member.role, "manage:users");

  try {
    if (req.method === "GET") {
      const all = await listMessages(org.id);
      /* Private threads are filtered out here, not in the browser. Sending
         them and hiding them client-side would put every private message in
         the network tab of everyone in the organization. */
      const messages = all.filter((m) => visibleTo(m, account.username));
      const since = await lastReadAt(org.id, account.username);
      let branches = [];
      try {
        branches = await branchList(await posTokenFor(account.username));
      } catch {
        /* The board must open even when the till is unreachable. Without the
           branch list the audience picker falls back to roles only, which is
           still a usable message. */
        branches = [];
      }
      return res.status(200).json({
        messages: messages.map((m) => publicMessage(m, member, account.username)),
        lastReadAt: since,
        me: account.username,
        role: member.role,
        mayFlag,
        maxLength: MAX_BODY,
        branches: branches.map((b) => ({ id: String(b.id), name: b.name })),
        roles: Object.entries(ROLES).map(([key, r]) => ({ key, label: r.label })),
        /* Who this person may write to directly, and whether they may address
           a whole branch or role. Both are decided here; the picker only
           renders what it is given. */
        people: addressable(org, account.username),
        mayBroadcast: mayFlag,
      });
    }

    if (req.method === "POST") {
      const { body, important = false, branches = [], roles = [], users = [] } = req.body || {};
      const flagged = Boolean(important) && mayFlag;

      /* A recipient outside this person's reach is dropped rather than
         refused. The picker cannot offer one, so a name arriving here is
         either a stale tab or somebody editing the request; neither deserves
         an error message explaining who else exists in the organization. */
      const reachable = new Set(addressable(org, account.username).map((p) => p.username));
      const to = (Array.isArray(users) ? users : []).filter((u) => reachable.has(String(u).trim().toLowerCase()));

      /* Branch and role targeting is a broadcast, which stays with whoever can
         manage people. A direct message is not, so anyone may send one. */
      const audience = mayFlag
        ? { branches, roles, users: to }
        : { branches: [], roles: [], users: to };

      const { message, error } = await postMessage(org.id, {
        author: account.username,
        body,
        important: flagged,
        audience,
      });
      if (error) return res.status(400).json({ error });

      /* Posting always succeeds, whatever the mail does. A board that refuses
         to accept a message because an inbox is unreachable is worse than one
         that accepts it and delivers late. */
      let notified = 0;
      if (flagged || isDirect(message)) {
        try {
          const names = {};
          try {
            const token = await posTokenFor(account.username);
            for (const b of await branchList(token)) names[String(b.id)] = b.name;
          } catch { /* subject falls back to branch ids */ }

          const orgName = org.name || account.username;
          const subject = subjectFor(orgName, message.audience, names, account.username);
          const targets = recipientsFor(org, message);

          for (const target of targets) {
            const person = await getAccount(target.username);
            if (!person?.email) continue;
            await sendMail({
              to: person.email,
              subject,
              text: isDirect(message)
                ? `${account.username} sent you a message on ${orgName}.\n\n${message.body}\n\nOpen PureMargin to reply.`
                : `${account.username} marked a message important on the ${orgName} board.\n\n${message.body}\n\nOpen PureMargin to reply.`,
              html: shell({
                title: isDirect(message)
                  ? `${account.username} sent you a message`
                  : "Marked important on the team board",
                intro: isDirect(message)
                  ? `This one is addressed to you personally on ${orgName}.`
                  : `${account.username} flagged this for the people it names on ${orgName}.`,
                blocks: [
                  quote(message.body),
                  ...(isDirect(message) ? [] : [row("Sent to", subjectAudience(message.audience, names))]),
                ],
                footer: "Open PureMargin to reply on the board.",
              }),
            });
            notified += 1;
          }
        } catch (err) {
          console.error("important message mail failed:", err);
        }

        await recordAudit(org.id, {
          actor: account.username,
          action: "message.important",
          detail: { branches: message.audience.branches, roles: message.audience.roles, notified },
        });
      }

      return res.status(200).json({ message: publicMessage(message, member, account.username), notified });
    }

    if (req.method === "PUT") {
      await markRead(org.id, account.username);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Use GET, POST or PUT." });
  } catch (err) {
    console.error("messages failed:", err);
    return res.status(500).json({ error: "server" });
  }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
