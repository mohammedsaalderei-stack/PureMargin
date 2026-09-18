import { getJSON, setJSON, del } from "./_store.js";
import { esc, row, shell, sendMail } from "./_mail.js";
import { getAccount } from "./_accounts.js";
import { can } from "./_roles.js";

/* The photograph attached to a punch, and who gets told about it.

   ── Why there is a photograph at all ─────────────────────────────────────

   The previous version of this asked for a six-digit code, and the file that
   holds it says plainly what a code is worth: it proves somebody who knew it
   was standing at the device, and a code can be passed to a friend. Every
   attendance system without a camera or a badge has that hole.

   A picture of the place, taken now, on the phone of the person arriving, is
   a different kind of evidence. It is not identity — nothing here claims it
   is, and a photograph can be a photograph of a photograph. What it is, is a
   record an owner can look at and judge for themselves, which is more than a
   number they cannot see. The shift of responsibility is the point: the
   machine records, the owner confirms.

   ── Two sizes, on purpose ────────────────────────────────────────────────

   A day's punches are shown as a strip of small pictures, and fetching a
   hundred kilobyte photograph for each of forty rows is four megabytes to
   render a list. So each punch stores a thumbnail — a few kilobytes, all of a
   day's kept together in one document and read in one go — and the full
   photograph separately, fetched only when somebody actually opens it.

   ── The owner can delete a photograph, and not the punch ─────────────────

   Those are different things and the difference matters. The punch is a ledger
   entry: somebody's hours are derived from it, and it is appended and never
   edited, like every other ledger in this codebase. The photograph is
   evidence attached to it, it is a picture of a workplace taken on a personal
   phone, and an owner who wants it gone should be able to remove it without
   quietly deleting the shift it belongs to.

   So deleting a photo leaves the punch, and the row afterwards says the
   picture was removed rather than pretending there never was one. */

const SHOT = (orgId, punchId) => `staff:${orgId}:shot:${punchId}`;
const THUMBS = (orgId, day) => `staff:${orgId}:thumbs:${day}`;
const SHOT_INDEX = (orgId) => `staff:${orgId}:shotindex`;
const THUMB_DAYS = (orgId) => `staff:${orgId}:thumbdays`;

/* A data URL, not bytes. The store holds JSON, and a photograph that arrived
   as a string and leaves as a string never has to be encoded twice.

   Generous next to what the browser actually sends — it downscales to roughly
   a hundred kilobytes before this ever sees it — because the cap is here to
   stop something absurd being posted at the open endpoint, not to second-guess
   a phone camera on a dark morning. */
export const MAX_PHOTO_CHARS = 700_000;
export const MAX_THUMB_CHARS = 30_000;

/* Roughly three months of a busy roster. Past that a photograph has been
   looked at or it never will be, and it is the largest thing this app stores
   per unit of usefulness. */
const KEEP_PHOTOS = 3000;
const KEEP_THUMB_DAYS = 90;

const IMAGE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

/* Whether this is something we are willing to store, and why not if not.

   Checked by shape rather than by decoding: a string that matches this is
   base64 of *something*, and proving it decodes to a real JPEG would mean
   parsing an image on the server, on an endpoint that takes no authentication.
   That is a worse trade than storing a few bytes of nonsense — the browser is
   the only thing that ever renders it, and it renders a broken data URL as a
   broken image, not as anything dangerous.

   An SVG would be a different matter, which is why the list above is the three
   raster types and does not include it. */
export function photoProblem(url, { max = MAX_PHOTO_CHARS } = {}) {
  const s = String(url || "");
  if (!s) return "missing";
  if (s.length > max) return "toobig";
  if (!IMAGE.test(s)) return "shape";
  return null;
}

export const dayKeyFor = (at) => {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

/* Store the picture for a punch, and retire whatever has aged out.

   The index is what makes retention possible at all: without a list of which
   photographs exist, old ones are unreachable keys that are never read and
   never deleted, and the store grows forever. */
export async function savePhoto(orgId, punchId, { full, thumb, at = Date.now() }) {
  const day = dayKeyFor(at);

  await setJSON(SHOT(orgId, punchId), { url: full, at });

  if (thumb) {
    const map = (await getJSON(THUMBS(orgId, day))) || {};
    map[punchId] = thumb;
    await setJSON(THUMBS(orgId, day), map);

    const days = (await getJSON(THUMB_DAYS(orgId))) || [];
    if (days[0] !== day) {
      const next = [day, ...days.filter((d) => d !== day)];
      const dropped = next.slice(KEEP_THUMB_DAYS);
      await setJSON(THUMB_DAYS(orgId), next.slice(0, KEEP_THUMB_DAYS));
      for (const old of dropped) await del(THUMBS(orgId, old));
    }
  }

  const index = (await getJSON(SHOT_INDEX(orgId))) || [];
  const next = [{ id: punchId, day, at }, ...index.filter((e) => e.id !== punchId)];
  const dropped = next.slice(KEEP_PHOTOS);
  await setJSON(SHOT_INDEX(orgId), next.slice(0, KEEP_PHOTOS));

  /* Only the full photograph is evicted. The thumbnail is a few kilobytes and
     is what the day's list draws, so an old row keeps its picture and loses
     the ability to be opened full size — which is the right way round. */
  for (const old of dropped) await del(SHOT(orgId, old.id));

  return { day };
}

export async function readPhoto(orgId, punchId) {
  return getJSON(SHOT(orgId, String(punchId)));
}

/* Every thumbnail for a day, in one read. */
export async function readThumbs(orgId, day) {
  return (await getJSON(THUMBS(orgId, day))) || {};
}

export async function readThumbsFor(orgId, days = []) {
  const out = {};
  for (const day of [...new Set(days)]) Object.assign(out, await readThumbs(orgId, day));
  return out;
}

/* Remove a photograph. The punch it belongs to is untouched.

   Both copies go, and the index entry with them, so nothing is left pointing
   at a key that no longer resolves. */
export async function removePhoto(orgId, punchId) {
  const id = String(punchId);
  const index = (await getJSON(SHOT_INDEX(orgId))) || [];
  const entry = index.find((e) => e.id === id);

  await del(SHOT(orgId, id));

  const day = entry?.day;
  if (day) {
    const map = await readThumbs(orgId, day);
    if (map[id]) {
      delete map[id];
      await setJSON(THUMBS(orgId, day), map);
    }
  } else {
    /* No index entry — an old photograph, or one whose index row was already
       trimmed. Sweep the days we still keep rather than leave the thumbnail
       showing after the owner asked for it to go. */
    for (const d of (await getJSON(THUMB_DAYS(orgId))) || []) {
      const map = await readThumbs(orgId, d);
      if (map[id]) {
        delete map[id];
        await setJSON(THUMBS(orgId, d), map);
        break;
      }
    }
  }

  if (entry) await setJSON(SHOT_INDEX(orgId), index.filter((e) => e.id !== id));
  return true;
}

/* ── Rate limiting ────────────────────────────────────────────

   This is the only endpoint in the app that writes without a session, so it is
   the only one where "how often may a stranger do this" has to be answered
   here rather than by the session having been issued in the first place. */

const RATE = (orgId, day) => `attend:rate:${orgId}:${day}`;

/* A thirty-person venue with two shifts makes about a hundred and twenty
   punches on its busiest day. Well above that, and far below what it would
   take to fill the store. */
export const PUNCH_LIMIT_PER_DAY = 400;

/* Two taps on a slow connection are one arrival. Without this the second
   becomes a departure and somebody's shift is recorded as four seconds long —
   which is a worse outcome than a tap that does nothing. */
export const REPEAT_WINDOW_MS = 90 * 1000;

export async function noteAndCheckRate(orgId, at = Date.now()) {
  const key = RATE(orgId, dayKeyFor(at));
  const used = Number((await getJSON(key))?.n || 0);
  if (used >= PUNCH_LIMIT_PER_DAY) return { ok: false, used };
  await setJSON(key, { n: used + 1, at });
  return { ok: true, used: used + 1 };
}

/* Their own last punch, if it was moments ago. */
export function recentRepeat(punches, employeeId, at = Date.now()) {
  return (punches || [])
    .filter((p) => p.employeeId === String(employeeId))
    .find((p) => at - p.at < REPEAT_WINDOW_MS && at - p.at >= 0) || null;
}

/* ── The mail ─────────────────────────────────────────────────

   Written in English and Arabic, both, in one message.

   Not a guess at the reader's language, because the server has no way to make
   one: the recipient is the owner or a manager, and the only language
   preference in this system lives in a browser that is not theirs — it is the
   phone of the cook who just clocked in. Sending in the cook's language would
   be a guess dressed up as a setting.

   Two languages rather than five, because this is a UAE product and these are
   the two a business here is run in. A notification is three facts long; it
   can carry both without becoming something nobody reads. */

const CLOCK = (at, tz) => {
  try {
    return new Date(at).toLocaleString("en-GB", {
      timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return new Date(at).toISOString().slice(0, 16).replace("T", " ");
  }
};

export function punchMail({ name, title, kind, at, branchName, business, link, tz = "Asia/Dubai" }) {
  const arrived = kind === "in";
  const when = CLOCK(at, tz);
  const where = branchName ? ` · ${branchName}` : "";

  const enLine = arrived ? `${name} clocked in` : `${name} clocked out`;
  const arLine = arrived ? `${name} سجّل الحضور` : `${name} سجّل الانصراف`;

  const subject = `${enLine} — ${when}`;

  const text = [
    `${enLine} at ${business || "your business"}${where}.`,
    `${when}`,
    title ? `Role: ${title}` : "",
    "",
    `${arLine} في ${business || "منشأتك"}${where}.`,
    "",
    "A photo was taken at the door. Open PureMargin to see it and confirm.",
    "صُوّرت المنشأة عند التسجيل. افتح PureMargin لمراجعتها.",
    link || "",
  ].filter(Boolean).join("\n");

  const html = shell({
    title: enLine,
    dir: "ltr",
    intro: `${business || ""}${where}`.trim(),
    blocks: [
      row("When", when),
      title ? row("Role", title) : "",
      row("Photo", "Taken at the door — open PureMargin to see it and confirm."),
      `<div style="margin:22px 0 0;padding-top:18px;border-top:1px solid rgba(139,92,246,.12)" dir="rtl">
         <div style="font-size:14px;font-weight:700;margin-bottom:6px">${esc(arLine)}</div>
         <div style="font-size:13px;line-height:1.7;color:#64748b">${esc(when)}${esc(where)}<br>صُوّرت المنشأة عند التسجيل. افتح PureMargin لمراجعة الصورة وتأكيدها.</div>
       </div>`,
      link ? `<div style="margin:22px 0 0"><a href="${esc(link)}" style="font-size:13px;font-weight:700;color:#8b5cf6">Open PureMargin</a></div>` : "",
    ].filter(Boolean),
    footer: "You're getting this because you manage staff on PureMargin. Turn it off on the Staff screen.",
  });

  return { subject, text, html };
}

/* Who is told, and whether anyone is.

   Everyone in the organization whose role can `manage:staff` — the same
   capability that gates the roster, because the set of people allowed to see
   attendance and the set who should hear about it are the same set, and
   deriving one from the other means a new role never has to be added twice.

   An address is optional in this product: accounts are created with a username
   and a password, and email is something somebody adds later. So "if there is
   an email" is not a nicety, it is the normal case for at least one member of
   most teams. Whoever has one is written to; the rest see it on the screen.

   Deliberately not awaited by the caller. A punch is recorded by then, and a
   mail provider having a slow minute must not turn a successful arrival into
   an error on the phone of somebody standing in a doorway. */
export async function notifyManagers(org, message) {
  if (!org || org.staffMail === false) return { sent: 0, reason: "off" };

  const usernames = Object.entries(org.members || {})
    .filter(([, m]) => can(m?.role, "manage:staff"))
    .map(([username]) => username);

  const seen = new Set();
  let sent = 0;

  for (const username of usernames) {
    let account = null;
    try { account = await getAccount(username); } catch { /* skip, not fatal */ }
    const to = String(account?.email || "").trim().toLowerCase();
    /* One message per address. An owner who is also listed under a second
       username should not get the same arrival twice. */
    if (!to || seen.has(to)) continue;
    seen.add(to);

    try {
      const out = await sendMail({ to, ...message });
      if (!out?.error) sent += 1;
    } catch (err) {
      console.error("[attendance] notification failed:", err.message);
    }
  }

  return { sent, considered: usernames.length };
}
