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

export async function sendMail({ to, subject, html, text }) {
  if (!to) return { error: "norecipient" };

  if (!configured) {
    console.log(
      `[mail] No RESEND_API_KEY set — not sending.\n  to: ${to}\n  subject: ${subject}\n  ${text || ""}`
    );
    return { skipped: true };
  }

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.MAIL_FROM || DEFAULT_FROM,
        to: [to],
        subject,
        html,
        text,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error(`mail send failed (${res.status}):`, detail);
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
