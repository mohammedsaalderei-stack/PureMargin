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

export const configured = Boolean(process.env.RESEND_API_KEY);

/* Resend rejects the whole send if the sender isn't `email@example.com` or
   `Name <email@example.com>`. A half-filled MAIL_FROM shouldn't cost somebody
   their reset mail, so anything that isn't one of those two shapes is ignored
   in favour of the shared sender, loudly. */
function from() {
  const configuredFrom = String(process.env.MAIL_FROM || "").trim();
  if (!configuredFrom) return DEFAULT_FROM;

  const address = configuredFrom.match(/<([^>]+)>\s*$/)?.[1] ?? configuredFrom;
  if (/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(address.trim())) return configuredFrom;

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
    body: JSON.stringify({ from: sender, to: [to], subject, html, text }),
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

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:32px;background:#F7F6FB;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1A1530">
    <div style="max-width:440px;margin:0 auto;background:#fff;border:1px solid rgba(139,92,246,.15);border-radius:14px;padding:32px">
      <div style="font-size:18px;font-weight:800;color:#8B5CF6;margin-bottom:24px">PureMargin</div>
      <div style="font-size:16px;font-weight:700;margin-bottom:8px">Reset your password</div>
      <p style="font-size:14px;line-height:1.6;color:#6B6580;margin:0 0 24px">
        Enter this code on the reset screen. It works for ${minutes} minutes.
      </p>
      <div style="font-size:30px;font-weight:800;letter-spacing:.18em;text-align:center;padding:18px;border-radius:12px;background:#F7F6FB;font-variant-numeric:tabular-nums">${code}</div>
      <p style="font-size:12px;line-height:1.6;color:#6B6580;margin:24px 0 0">
        If you didn't ask to reset your password, ignore this message — nothing
        on your account has changed.
      </p>
    </div>
  </body></html>`;

  return { subject, html, text };
}
