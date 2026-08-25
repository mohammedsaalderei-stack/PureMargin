import { requireAuth } from "./_auth.js";
import { getAccount, posTokenFor } from "./_accounts.js";
import { orgFor, membership, ROLES, can } from "./_org.js";
import { branchList } from "./_data.js";
import { recordAudit } from "./_audit.js";
import { sendMail } from "./_mail.js";
import {
  listMessages, postMessage, markRead, lastReadAt,
  recipientsFor, matchesAudience, audienceIsEveryone, MAX_BODY,
} from "./_messages.js";

/* The team board.

   GET  — the messages this member can see, plus who they can address
   POST — write one; { body, important, branches: [], roles: [] }
   PUT  — mark the board read up to now

   Marking a message important is limited to `manage:users`, which in practice
   means the owner. Important is not a formatting choice: it mails people. If
   everyone could reach everyone's inbox, the flag would be worth nothing
   within a week, and the people it is meant to reach would start ignoring it. */

function publicMessage(message, member) {
  return {
    ...message,
    forMe: matchesAudience(message.audience, member),
    everyone: audienceIsEveryone(message.audience),
  };
}

/* An important message names its audience in the subject, because somebody
   scanning a phone inbox decides whether to open it from that line alone. */
function subjectFor(orgName, audience, branchNames) {
  const parts = [];
  if (audience.branches.length) {
    parts.push(audience.branches.map((id) => branchNames[id] || id).join(", "));
  }
  if (audience.roles.length) {
    parts.push(audience.roles.map((r) => ROLES[r]?.label || r).join(", "));
  }
  const who = parts.length ? parts.join(" · ") : "Everyone";
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
      const messages = await listMessages(org.id);
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
        messages: messages.map((m) => publicMessage(m, member)),
        lastReadAt: since,
        me: account.username,
        role: member.role,
        mayFlag,
        maxLength: MAX_BODY,
        branches: branches.map((b) => ({ id: String(b.id), name: b.name })),
        roles: Object.entries(ROLES).map(([key, r]) => ({ key, label: r.label })),
      });
    }

    if (req.method === "POST") {
      const { body, important = false, branches = [], roles = [] } = req.body || {};
      const flagged = Boolean(important) && mayFlag;

      const { message, error } = await postMessage(org.id, {
        author: account.username,
        body,
        important: flagged,
        audience: { branches, roles },
      });
      if (error) return res.status(400).json({ error });

      /* Posting always succeeds, whatever the mail does. A board that refuses
         to accept a message because an inbox is unreachable is worse than one
         that accepts it and delivers late. */
      let notified = 0;
      if (flagged) {
        try {
          const names = {};
          try {
            const token = await posTokenFor(account.username);
            for (const b of await branchList(token)) names[String(b.id)] = b.name;
          } catch { /* subject falls back to branch ids */ }

          const orgName = org.name || account.username;
          const subject = subjectFor(orgName, message.audience, names);
          const targets = recipientsFor(org, message);

          for (const target of targets) {
            const person = await getAccount(target.username);
            if (!person?.email) continue;
            await sendMail({
              to: person.email,
              subject,
              text: `${account.username} marked a message important on the ${orgName} board.\n\n${message.body}\n\nOpen PureMargin to reply.`,
              html: `<p><strong>${account.username}</strong> marked a message important on the <strong>${orgName}</strong> board.</p>`
                + `<blockquote style="margin:16px 0;padding:12px 16px;border-inline-start:3px solid #8B5CF6;background:#F7F6FB;white-space:pre-wrap">${escapeHtml(message.body)}</blockquote>`
                + `<p>Open PureMargin to reply.</p>`,
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

      return res.status(200).json({ message: publicMessage(message, member), notified });
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
