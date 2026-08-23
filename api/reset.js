import crypto from "crypto";
import { issueToken } from "./_auth.js";
import { findAccount, resetPassword, publicAccount } from "./_accounts.js";
import { getJSON, setJSON, del } from "./_store.js";
import { sendMail, resetCodeMail, configured as mailConfigured } from "./_mail.js";

/* Forgotten passwords.

   POST  ask for a code — mails a six-digit code to the address on the account
   PUT   spend the code — verifies it and sets the new password

   Two rules shape the whole thing:

   1. Neither method ever reveals whether an account exists. A wrong address
      gets the same 200 and the same wording as a right one, or this endpoint
      becomes a way to enumerate customers.
   2. The stored code is a hash, never the code itself. A database dump must
      not hand over live reset codes.

   A successful reset signs the caller in, because the alternative is asking
   somebody who just proved they own the address to type the password they
   only invented ten seconds ago. */

const CODE_TTL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
/* Long enough that a second request doesn't look broken, short enough not to
   strand somebody who genuinely lost the first mail. */
const RESEND_GAP_MS = 60 * 1000;

const RESET_KEY = (username) => `reset:${username}`;

function hashCode(code, salt) {
  return crypto.scryptSync(String(code), salt, 32).toString("hex");
}

function newCode() {
  // 100000–999999: always six digits, no leading zero to lose in transit.
  return String(100000 + (crypto.randomBytes(4).readUInt32BE(0) % 900000));
}

async function requestCode(req, res) {
  const { identifier } = req.body || {};
  if (!identifier) return res.status(400).json({ error: "missing" });

  /* The generic answer, sent whatever actually happened below. */
  const ok = () => res.status(200).json({ ok: true, mail: mailConfigured });

  const account = await findAccount(identifier);
  if (!account?.email) return ok();

  const existing = await getJSON(RESET_KEY(account.username));
  if (existing && Date.now() - (existing.sentAt || 0) < RESEND_GAP_MS) {
    // Already mailed a code moments ago. Don't send a second one, but don't
    // say so either — the answer has to look identical from outside.
    return ok();
  }

  const code = newCode();
  const salt = crypto.randomBytes(16).toString("hex");
  await setJSON(RESET_KEY(account.username), {
    salt,
    hash: hashCode(code, salt),
    expires: Date.now() + CODE_TTL_MS,
    attempts: 0,
    sentAt: Date.now(),
  });

  const mail = resetCodeMail({ code, minutes: Math.round(CODE_TTL_MS / 60000) });
  await sendMail({ to: account.email, ...mail });

  return ok();
}

async function useCode(req, res) {
  const { identifier, code, password } = req.body || {};
  if (!identifier || !code || !password) return res.status(400).json({ error: "missing" });

  const account = await findAccount(identifier);
  /* An unknown account and a wrong code are the same answer for the same
     reason as above. */
  const badCode = () => res.status(400).json({ error: "badcode" });

  if (!account) return badCode();

  const record = await getJSON(RESET_KEY(account.username));
  if (!record) return badCode();

  if (record.expires < Date.now()) {
    await del(RESET_KEY(account.username));
    return res.status(400).json({ error: "expired" });
  }

  if ((record.attempts || 0) >= MAX_ATTEMPTS) {
    await del(RESET_KEY(account.username));
    return res.status(429).json({ error: "toomany" });
  }

  const attempt = hashCode(String(code).trim(), record.salt);
  const a = Buffer.from(attempt);
  const b = Buffer.from(record.hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    await setJSON(RESET_KEY(account.username), {
      ...record,
      attempts: (record.attempts || 0) + 1,
    });
    return badCode();
  }

  const { account: updated, error } = await resetPassword(account.username, password);
  // "short" / "weak" — the code was right, the new password isn't good enough.
  if (error) return res.status(400).json({ error });

  // Spent. A code must never work twice.
  await del(RESET_KEY(account.username));

  return res.status(200).json({
    token: issueToken(updated.username, updated.tokenVersion),
    account: publicAccount(updated),
    username: updated.username,
  });
}

export default async function handler(req, res) {
  try {
    if (req.method === "POST") return await requestCode(req, res);
    if (req.method === "PUT") return await useCode(req, res);
    return res.status(405).json({ error: "Use POST or PUT." });
  } catch (err) {
    console.error("reset endpoint failed:", err);
    return res.status(500).json({ error: "server" });
  }
}
