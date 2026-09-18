/* Clocking in, from a link the business handed out.

   GET  ?what=place&key=          — which business, which branches, who works there
   POST ?what=punch               — { key, branch, employeeId, photo, thumb }

   ── Why this endpoint has no session, and is not public either ───────────

   Every other route in this app starts with `requireAuth`. This one cannot.
   The person it serves is a cook arriving for a shift, on their own phone,
   with no account — that is the premise the employee record was built on, and
   handing every kitchen porter a login so they can record that they turned up
   is the thing this feature exists to avoid.

   The first version concluded from that it had to be open to anybody: a public
   index of every business using attendance, searchable by name, with the staff
   list one call further in. That was the wrong conclusion. Somebody who is
   handed a link by their manager on their first day does not need to search
   for their own restaurant, and the search cost every business the privacy of
   its staff list.

   So the URL is the authentication, the same way it is for the POS webhook in
   `_loyversehook.js`. No key, no answer — and there is nothing to enumerate,
   because there is no longer a list of businesses to enumerate.

   ── What that is worth, stated plainly ───────────────────────────────────

   A key is a bearer credential. Whoever holds the link can read that one
   business's branches and staff names and can record a punch against a name.
   It will be forwarded into a staff group chat, which is fine — that group is
   the staff — and somebody who leaves keeps it until it is rotated, which is
   why rotation is one button on the staff screen.

   What it is not is identity. The photograph is not identity either, and does
   not claim to be: it is something the owner can look at and judge, next to
   the name and the time. Between them they make a false record take effort and
   leave evidence, which for attendance is the achievable goal.

   The rest is volume:

     · a punch within ninety seconds of the same person's last one is the same
       tap, not the opposite direction
     · four hundred punches per business per day, after which the day is full

   ── The three things this deliberately does not distinguish ──────────────

   A key that never existed, a key that has been rotated away, and a name that
   belongs to somebody who has left all come back the same way. Whoever is
   holding a link that does not work needs to ask their manager either way. */

import { resolveClockKey } from "./_clockkey.js";
import { getEmployee, listEmployees, listPunches, punch } from "./_employees.js";
import { getOrg } from "./_org.js";
import { recordAudit } from "./_audit.js";
import { publicOrigin } from "./_mail.js";
import {
  photoProblem, savePhoto, noteAndCheckRate, recentRepeat,
  punchMail, notifyManagers, MAX_THUMB_CHARS,
} from "./_attendance.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  /* Nothing here should ever be indexed, and there is no page to index — but
     the header costs nothing and this is the one address that gets pasted
     into places that follow links. */
  res.setHeader("X-Robots-Tag", "noindex, nofollow");

  try {
    const what = String(req.query?.what || "");
    const key = req.method === "POST" ? req.body?.key : req.query?.key;
    const place = await resolveClockKey(key);
    if (!place) return res.status(404).json({ error: "nokey" });

    const known = place.branches.map((b) => String(b.id));

    if (req.method === "GET" && what === "place") {
      const branchId = String(req.query?.branch || "").trim();
      if (branchId && !known.includes(branchId)) {
        return res.status(400).json({ error: "nobranch" });
      }

      const people = (await listEmployees(place.orgId))
        /* Somebody with no branch works anywhere — a floater, and the right
           answer for a business that should never have been asked which of its
           one branch a person is at. */
        .filter((e) => !branchId || !e.branchId || String(e.branchId) === branchId);

      return res.status(200).json({
        name: place.name,
        branches: place.branches,
        /* Name and job. Never the branch assignment, never anything about the
           business itself — the link is a door to one screen, not a read of an
           organization. */
        people: people.map((e) => ({ id: e.id, name: e.name, title: e.title })),
      });
    }

    if (req.method !== "POST" || what !== "punch") {
      return res.status(400).json({ error: "what" });
    }

    const body = req.body || {};
    const branchId = String(body.branch || "").trim();
    /* More than one branch means saying which. Recording a shift against the
       wrong restaurant is worse than asking. */
    if (known.length > 1 && !known.includes(branchId)) {
      return res.status(400).json({ error: "nobranch" });
    }

    /* The picture, before anything else is touched.

       Checked first so a punch is never written for a request that was going
       to be refused — the ledger is append-only, and a row that has to be
       reversed because the photo was rejected afterwards is a row somebody has
       to explain later. */
    const bad = photoProblem(body.photo);
    if (bad) return res.status(400).json({ error: `photo:${bad}` });
    if (body.thumb && photoProblem(body.thumb, { max: MAX_THUMB_CHARS })) {
      return res.status(400).json({ error: "photo:thumb" });
    }

    const employee = await getEmployee(place.orgId, body.employeeId);
    if (!employee || employee.archived) return res.status(404).json({ error: "noperson" });
    if (employee.branchId && branchId && String(employee.branchId) !== branchId) {
      return res.status(400).json({ error: "wrongbranch" });
    }

    const now = Date.now();

    /* Their own last punch, if it was moments ago. Returned as a success
       carrying the punch that already exists, because from where the person is
       standing it did work — twice. Saying "too soon" would read as a refusal
       of the arrival they just made. */
    const today = await listPunches(place.orgId, { from: now - DAY_MS });
    const repeat = recentRepeat(today, employee.id, now);
    if (repeat) {
      return res.status(200).json({
        name: employee.name, title: employee.title,
        kind: repeat.kind, at: repeat.at, repeat: true,
      });
    }

    const rate = await noteAndCheckRate(place.orgId, now);
    if (!rate.ok) return res.status(429).json({ error: "busy" });

    const out = await punch(place.orgId, {
      employeeId: employee.id,
      branchId: branchId || employee.branchId || known[0] || null,
      at: now,
      source: "web",
      photo: true,
    });

    await savePhoto(place.orgId, out.punch.id, {
      full: body.photo, thumb: body.thumb || "", at: now,
    });

    const branchName = place.branches.find((b) => String(b.id) === String(out.punch.branchId))?.name || "";

    await recordAudit(place.orgId, {
      /* No account made this. The record says so rather than borrowing a name
         that would imply somebody signed in did it. */
      actor: "attendance",
      action: `staff.${out.kind}`,
      target: employee.id,
      detail: { name: employee.name, branchId: out.punch.branchId, at: out.punch.at, source: "web" },
    });

    /* Not awaited. The punch is recorded and the phone should say so now; a
       mail provider having a slow minute is not this person's problem. */
    getOrg(place.orgId)
      .then((org) => notifyManagers(org, punchMail({
        name: employee.name,
        title: employee.title,
        kind: out.kind,
        at: out.punch.at,
        branchName,
        business: place.name,
        link: `${publicOrigin(req)}/#/app/employees`,
      })))
      .catch((err) => console.error("[attendance] notify failed:", err.message));

    return res.status(200).json({
      name: employee.name,
      title: employee.title,
      kind: out.kind,
      at: out.punch.at,
      since: out.since,
      workedMs: out.workedMs,
      branchName,
    });
  } catch (err) {
    console.error("attendance endpoint failed:", err);
    return res.status(500).json({ error: "server" });
  }
}
