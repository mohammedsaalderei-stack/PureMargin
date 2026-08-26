/* Outgoing mail.

   One provider (Resend), reached over plain HTTP so there's no dependency to
   install and nothing to keep warm between invocations.

   With no API key configured, sending is a no-op that logs the message to the
   server console instead. That keeps local development working — the reset
   code is readable in `docker compose logs api` — without silently pretending
   mail went out in production, where the missing key is reported to the
   caller. */

const ENDPOINT = "https://api.resend.com/emails";

/* Resend's shared sender. Works without verifying a domain, which means reset
   mail flows on day one; a real from-address is set through MAIL_FROM. */
const DEFAULT_FROM = "PureMargin <onboarding@resend.dev>";

/* Where a reply should land. Outgoing mail is sent from a no-reply sender, but
   people reply to it anyway, so every message carries a monitored address. */
export const SUPPORT_EMAIL = "support@puremargin.ae";
const REPLY_TO = process.env.MAIL_REPLY_TO || SUPPORT_EMAIL;

export const configured = Boolean(process.env.RESEND_API_KEY);

/* Resend rejects the whole send if the sender isn't `email@example.com` or
   `Name <email@example.com>`. A half-filled MAIL_FROM shouldn't cost somebody
   their reset mail, so anything that isn't one of those two shapes is ignored
   in favour of the shared sender, loudly. */
function from() {
  const configuredFrom = String(process.env.MAIL_FROM || "").trim();
  if (!configuredFrom) return DEFAULT_FROM;

  const address = configuredFrom.match(/<([^>]+)>\s*$/)?.[1] ?? configuredFrom;
  if (/^[^\s@<>]+@[^\s@.<>]+\.[^\s@<>]+$/.test(address.trim())) return configuredFrom;

  console.warn(
    "[mail] MAIL_FROM is not a valid sender — expected `email@example.com` or " +
      "`Name <email@example.com>`. Falling back to the shared Resend sender."
  );
  return DEFAULT_FROM;
}

async function post({ sender, to, subject, html, text }) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: sender,
      to: [to],
      reply_to: REPLY_TO,
      subject,
      html,
      text,
    }),
  });
  return { ok: res.ok, status: res.status, detail: res.ok ? "" : await res.text() };
}

export async function sendMail({ to, subject, html, text }) {
  if (!to) return { error: "norecipient" };

  if (!configured) {
    console.log(
      `[mail] No RESEND_API_KEY set — not sending.\n  to: ${to}\n  subject: ${subject}\n  ${text || ""}`
    );
    return { skipped: true };
  }

  try {
    const sender = from();
    let result = await post({ sender, to, subject, html, text });

    /* Resend refuses a sender whose domain isn't verified on the account yet.
       That's a setup step on their side, not a reason to swallow somebody's
       reset code, so the same message goes out once more from the shared
       sender. Once the domain is verified the first attempt succeeds and this
       never runs. */
    if (!result.ok && sender !== DEFAULT_FROM && /from|domain/i.test(result.detail)) {
      console.warn(
        `[mail] Resend rejected the MAIL_FROM sender (${result.status}) — verify its ` +
          "domain at resend.com/domains. Retrying from the shared sender."
      );
      result = await post({ sender: DEFAULT_FROM, to, subject, html, text });
    }

    if (!result.ok) {
      console.error(`mail send failed (${result.status}):`, result.detail);
      return { error: "send" };
    }
    return { sent: true };
  } catch (err) {
    console.error("mail send failed:", err);
    return { error: "send" };
  }
}

/* The reset code mail.
   Deliberately plain: a code, how long it lasts, and what to do if it wasn't
   asked for. Anything more decorative reads like a phishing attempt. */
/* One layout for every message the product sends.

   The reset code had a designed email — a card, the wordmark, a readable
   hierarchy — and everything else went out as a bare paragraph of unstyled
   HTML. A team invitation is the first thing a new member ever sees from this
   product, and it looked like a mail-merge accident next to the one email that
   had been thought about.

   Table-based, with inline styles and no external stylesheet, because that is
   what mail clients render predictably. Outlook ignores flexbox, Gmail strips
   <style> blocks, and a layout that depends on either arrives broken to the
   half of a restaurant team reading it on a phone.

   Everything interpolated into an email must be escaped. A supplier name or a
   message body is somebody else's text, and unescaped it is an injection into
   an inbox. */

const INK = "#1A1530";
const MUTED = "#6B6580";
const IRIS = "#8B5CF6";
const WASH = "#F7F6FB";

export function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/* A button that survives Outlook, which ignores padding on an anchor. */
function button(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0">
    <tr><td style="border-radius:10px;background:${IRIS}">
      <a href="${esc(href)}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px">${esc(label)}</a>
    </td></tr>
  </table>`;
}

/* `blocks` is already-safe HTML built by the helpers below; `title` and
   `intro` are plain text and are escaped here. */
/* Whether this message reads right to left.

   Detected from the text rather than taken as a parameter, because the server
   does not know what language a recipient reads in — the preference lives in
   their browser. A caller that does know can override it. Without this an
   Arabic invitation arrives set flush left, which is legible and wrong in the
   way that tells somebody the product was not built for them. */
function looksRTL(...parts) {
  return /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(parts.join(" "));
}

export function shell({ title, intro = "", blocks = [], footer = "", dir }) {
  const direction = dir || (looksRTL(title, intro, footer) ? "rtl" : "ltr");
  /* The charset declaration is not optional here. Without it a client that
     guesses latin-1 turns every curly quote into "â€™" and every Arabic letter
     into nonsense — and this product sends mail in four languages, three of
     them non-Latin. The viewport line keeps a phone from zooming out to fit a
     desktop-width table. */
  return `<!DOCTYPE html><html dir="${direction}"><head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>${esc(title)}</title>
  </head><body dir="${direction}" style="margin:0;padding:32px;background:${WASH};font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:${INK};text-align:${direction === "rtl" ? "right" : "left"}">
    <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid rgba(139,92,246,.15);border-radius:14px;padding:32px">
      <div style="font-size:18px;font-weight:800;color:${IRIS};margin-bottom:24px">PureMargin</div>
      <div style="font-size:16px;font-weight:700;margin-bottom:8px">${esc(title)}</div>
      ${intro ? `<p style="font-size:14px;line-height:1.6;color:${MUTED};margin:0 0 20px">${esc(intro)}</p>` : ""}
      ${blocks.join("\n")}
      ${footer ? `<p style="font-size:12px;line-height:1.6;color:${MUTED};margin:24px 0 0;padding-top:16px;border-top:1px solid rgba(139,92,246,.12)">${esc(footer)}</p>` : ""}
    </div>
  </body></html>`;
}

/* A labelled row, for the facts an email is actually carrying. */
export function row(label, value) {
  return `<div style="margin:0 0 14px">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:${MUTED};margin-bottom:3px">${esc(label)}</div>
    <div style="font-size:14px;line-height:1.6;white-space:pre-wrap">${esc(value)}</div>
  </div>`;
}

/* Somebody else's words, set apart so they read as a quotation rather than as
   the product talking. */
export function quote(text) {
  return `<blockquote style="margin:0 0 20px;padding:12px 16px;border-inline-start:3px solid ${IRIS};background:${WASH};border-radius:0 10px 10px 0;font-size:14px;line-height:1.6;white-space:pre-wrap">${esc(text)}</blockquote>`;
}

export function bigCode(code) {
  return `<div style="font-size:30px;font-weight:800;letter-spacing:.18em;text-align:center;padding:18px;border-radius:12px;background:${WASH};font-variant-numeric:tabular-nums">${esc(code)}</div>`;
}

export { button };

export function resetCodeMail({ code, minutes }) {
  const subject = `${code} is your PureMargin reset code`;

  const text = [
    `Your PureMargin password reset code is ${code}.`,
    ``,
    `Enter it on the reset screen within ${minutes} minutes.`,
    ``,
    `If you didn't ask to reset your password, you can ignore this message —`,
    `nothing has changed on your account.`,
  ].join("\n");

  const html = shell({
    title: "Reset your password",
    intro: `Enter this code on the reset screen. It works for ${minutes} minutes.`,
    blocks: [bigCode(code)],
    footer: "If you didn't ask to reset your password, ignore this message — nothing on your account has changed.",
  });

  return { subject, html, text };
}
