/* Clocking in from the open web.

   GET  ?what=stores&q=            — businesses matching what was typed
        ?what=people&store=&branch= — who can clock in there
   POST ?what=punch                — { store, branch, employeeId, photo, thumb }

   ── Why this endpoint has no session ─────────────────────────────────────

   Every other route in this app starts with `requireAuth`. This one cannot.
   The person it serves is a cook arriving for a shift, on their own phone,
   with no account — that is the premise the employee record was built on, and
   handing every kitchen porter a login so they can record that they turned up
   is the thing this feature exists to avoid.

   So the honest description is: this is a public write, and everything below
   is the answer to "then what stops anyone doing it".

   ── What actually stops it ───────────────────────────────────────────────

   Not much, and saying so plainly is better than implying otherwise.

   A stranger who finds a business in the directory can see its staff list and
   record an arrival against a name. What they cannot do is record one without
   a photograph, and the photograph is the control: it is taken, it is kept, it
   is shown to the owner next to the name, and a punch with a picture of
   somewhere that is not the restaurant is a punch the owner can see is wrong.
   This does not prevent a false record. It makes one visible, which for
   attendance is the achievable goal — the PIN it replaces did not manage
   either, and could be passed to a friend without leaving a trace.

   The rest is about volume rather than truthfulness:

     · a business appears only once it has opened the staff screen
     · a search needs two characters and returns eight rows, so the directory
       cannot be walked out a page at a time
     · a punch within ninety seconds of the same person's last one is treated
       as the same tap, not as the opposite direction
     · four hundred punches per business per day, after which the day is full

   ── The three things this deliberately does not say ──────────────────────

   A wrong store id, a wrong branch, and a name that belongs to somebody who
   has left all come back the same way. The endpoint is open; anything that
   distinguishes them turns it into a way to ask questions about a business
   from outside it. */

import {
  getStore, searchStores, readDirectory, MIN_QUERY,
} from "./_directory.js";
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

  try {
    const what = String(req.query?.what || "");

    if (req.method === "GET" && what === "stores") {
      const q = String(req.query?.q || "");
      if (q.trim().length < MIN_QUERY) return res.status(200).json({ stores: [], short: true });
      return res.status(200).json({ stores: searchStores(await readDirectory(), q) });
    }

    if (req.method === "GET" && what === "people") {
      const store = await getStore(req.query?.store);
      /* No such business, and a business that has never switched attendance
         on, are one answer. */
      if (!store) return res.status(404).json({ error: "nostore" });

      const branchId = String(req.query?.branch || "").trim();
      const known = store.branches.map((b) => String(b.id));
      if (branchId && !known.includes(branchId)) {
        return res.status(400).json({ error: "nobranch" });
      }

      const people = (await listEmployees(store.id))
        /* A person with no branch works anywhere — a floater, and the right
           answer for a business that should never have been asked which of
           its one branch somebody is at. */
        .filter((e) => !branchId || !e.branchId || String(e.branchId) === branchId);

      return res.status(200).json({
        store: { id: store.id, name: store.name },
        branch: branchId || null,
        /* Name and job. Never the hash, never the branch assignment, never
           when their code was last issued — nothing that says anything about
           the business to somebody who is not part of it. */
        people: people.map((e) => ({ id: e.id, name: e.name, title: e.title })),
      });
    }

    if (req.method !== "POST" || what !== "punch") {
      return res.status(400).json({ error: "what" });
    }

    const body = req.body || {};
    const store = await getStore(body.store);
    if (!store) return res.status(404).json({ error: "nostore" });

    const known = store.branches.map((b) => String(b.id));
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

    const employee = await getEmployee(store.id, body.employeeId);
    /* Unknown, and belonging to somebody who has left, are one answer. */
    if (!employee || employee.archived) return res.status(404).json({ error: "noperson" });
    if (employee.branchId && branchId && String(employee.branchId) !== branchId) {
      return res.status(400).json({ error: "wrongbranch" });
    }

    const now = Date.now();

    /* Their own last punch, if it was moments ago. Returned as a success
       carrying the punch that already exists, because from where the person is
       standing it did work — twice. Saying "too soon" would read as a refusal
       of the arrival they just made. */
    const today = await listPunches(store.id, { from: now - DAY_MS });
    const repeat = recentRepeat(today, employee.id, now);
    if (repeat) {
      return res.status(200).json({
        name: employee.name, title: employee.title,
        kind: repeat.kind, at: repeat.at, repeat: true,
      });
    }

    const rate = await noteAndCheckRate(store.id, now);
    if (!rate.ok) return res.status(429).json({ error: "busy" });

    const out = await punch(store.id, {
      employeeId: employee.id,
      branchId: branchId || employee.branchId || known[0] || null,
      at: now,
      source: "web",
      photo: true,
    });

    await savePhoto(store.id, out.punch.id, {
      full: body.photo, thumb: body.thumb || "", at: now,
    });

    const branchName = store.branches.find((b) => String(b.id) === String(out.punch.branchId))?.name || "";

    await recordAudit(store.id, {
      /* No account made this. The record says so rather than borrowing a name
         that would imply somebody signed in did it. */
      actor: "attendance",
      action: `staff.${out.kind}`,
      target: employee.id,
      detail: { name: employee.name, branchId: out.punch.branchId, at: out.punch.at, source: "web" },
    });

    /* Not awaited. The punch is recorded and the phone should say so now; a
       mail provider having a slow minute is not this person's problem. */
    getOrg(store.id)
      .then((org) => notifyManagers(org, punchMail({
        name: employee.name,
        title: employee.title,
        kind: out.kind,
        at: out.punch.at,
        branchName,
        business: store.name,
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
