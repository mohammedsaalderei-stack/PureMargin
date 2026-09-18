/* Staff and attendance, for the people who run the place.

   GET  ?what=roster[&branches=a,b]  — who works here, who is on shift, today
        ?what=log&from=&to=          — completed shifts in a window
        ?what=photo&id=              — one punch's photograph, full size
   POST ?what=add      { name, title, branchId }
        ?what=update   { id, name, title, branchId }
        ?what=archive  { id, archived }
        ?what=punch    { employeeId, branchId }   — recorded for somebody
        ?what=unphoto  { id }                     — remove a picture, keep the punch
        ?what=rotatekey                           — new link, old one dead
        ?what=settings { staffMail }

   ── This is the manager's half ───────────────────────────────────────────

   The other half is `api/attendance.js`, which takes no session at all: it is
   where somebody arriving for a shift records it, from their own phone, with
   a photograph of the place. That is the path that gets used dozens of times
   a day. Everything here is the other audience — reading what was recorded,
   keeping the roster, and clearing up after it.

   Every action on this file needs `manage:staff`, punching included. That is
   a deliberate reversal: the old version left punching ungated so a device at
   the pass could take attendance without a manager present. There is no
   device at the pass any more, so the only thing this path is now for is a
   manager recording a shift on somebody's behalf — which is exactly the thing
   that should need permission and should write down who did it. */

import { requireAuth } from "./_auth.js";
import { scopeFor, effectiveBranches, parseBranchParam, unlockedBranches, saveOrg } from "./_org.js";
import { posTokenFor } from "./_accounts.js";
import { branchList } from "./_data.js";
import { recordAudit } from "./_audit.js";
import { clockKey, rotateClockKey, publishClockIn } from "./_clockkey.js";
import { publicOrigin } from "./_mail.js";
import {
  listEmployees, addEmployee, updateEmployee, archiveEmployee,
  getEmployee, listPunches, onShift, punch, shiftsFrom,
} from "./_employees.js";
import {
  readPhoto, readThumbsFor, removePhoto, dayKeyFor, punchMail, notifyManagers,
} from "./_attendance.js";

const startOfDay = (now = Date.now()) => {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  try {
    let roster = [];
    try {
      roster = await branchList(await posTokenFor(session.username));
    } catch { /* no till connected: one unnamed place, which is still a place */ }

    const scope = await scopeFor(session.account, roster.map((b) => b.id));
    const orgId = scope.org?.id;
    if (!orgId) return res.status(403).json({ error: "noorg" });

    const may = (capability) => scope.capabilities.includes(capability);
    const branchNames = Object.fromEntries(roster.map((b) => [String(b.id), b.name]));
    const what = String(req.query?.what || "roster");

    res.setHeader("Cache-Control", "no-store");

    if (req.method === "GET") {
      if (!may("manage:staff")) return res.status(403).json({ error: "forbidden" });

      /* One photograph, full size, fetched only when somebody opens it.

         Ahead of the rest because it answers with a single image and has no
         business loading a roster to do it. */
      if (what === "photo") {
        const id = String(req.query?.id || "");
        const mine = (await listPunches(orgId)).some((p) => p.id === id);
        /* Scoped to this organization before it is read: the key is
           org-prefixed, but checking the punch exists here as well means a
           guessed id from another business cannot be fetched by a member of
           this one. */
        if (!mine) return res.status(404).json({ error: "nophoto" });
        const shot = await readPhoto(orgId, id);
        if (!shot?.url) return res.status(404).json({ error: "nophoto" });
        return res.status(200).json({ id, url: shot.url, at: shot.at });
      }

      const branches = effectiveBranches(parseBranchParam(req.query?.branches), scope.authorized);
      const inScope = (branchId) =>
        !branchId || !branches.length || branches.includes(String(branchId));

      const people = (await listEmployees(orgId)).filter((e) => inScope(e.branchId));
      const known = new Set(people.map((e) => e.id));

      if (what === "log") {
        const from = Number(req.query?.from) || startOfDay(Date.now() - 6 * 86400000);
        const to = Number(req.query?.to) || Date.now();
        const punches = (await listPunches(orgId, { from, to })).filter((p) => known.has(p.employeeId));
        return res.status(200).json({
          from, to, branchNames,
          shifts: shiftsFrom(punches),
          punches,
          thumbs: await readThumbsFor(orgId, punches.filter((p) => p.photo).map((p) => dayKeyFor(p.at))),
          employees: people.map((e) => ({ id: e.id, name: e.name, title: e.title })),
        });
      }

      const today = (await listPunches(orgId, { from: startOfDay() }))
        .filter((p) => known.has(p.employeeId));

      /* What the clock-in link shows, refreshed by this read.

         Written here rather than from a button so that a branch renamed in
         the till shows up under its new name the next time anybody opens
         this screen, with no second thing to remember to run. The key itself
         is created on the same call if this is the first time.

         `unlockedBranches` rather than the reader's own scope: this is what
         everyone on the rota sees, and a branch manager opening the screen
         should not quietly shrink the list of places the rest of the staff
         can clock in at. */
      const unlocked = unlockedBranches(scope.org, roster.map((b) => b.id));
      await publishClockIn(orgId, {
        name: scope.org?.name || session.account?.business || "",
        branches: unlocked.map((id) => ({ id, name: branchNames[String(id)] || "" })),
      });

      return res.status(200).json({
        branches,
        branchNames,
        /* The link to hand out, key and all.

           Built here because the browser cannot know its own public origin
           when the app is behind a custom domain — and because the key is
           the one thing on this screen that must never be guessable, so it
           is sent to a session that has already proved `manage:staff`.

           The key rides in the hash. A fragment is never sent to the server
           in a request line and never appears in a Referer header, so the
           link does not end up in an access log or get handed to the next
           site somebody opens. */
        clockInUrl: `${publicOrigin(req)}/#/attendance/${await clockKey(orgId)}`,
        staffMail: scope.org?.staffMail !== false,
        /* Today's pictures, small, all in one read. The full-size ones are
           fetched one at a time and only when opened. */
        thumbs: await readThumbsFor(orgId, today.filter((p) => p.photo).map((p) => dayKeyFor(p.at))),
        employees: people.map((e) => ({
          id: e.id, name: e.name, title: e.title, branchId: e.branchId,
          archived: e.archived,
        })),
        onShift: onShift(today).map((p) => ({
          employeeId: p.employeeId, branchId: p.branchId, since: p.at,
        })),
        today: today.sort((a, b) => b.at - a.at),
        canManage: may("manage:staff"),
      });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "Use GET or POST." });
    const body = req.body || {};

    if (!may("manage:staff")) return res.status(403).json({ error: "forbidden" });

    /* A punch recorded for somebody else.

       Not the ordinary way a shift gets recorded — that happens on the
       clock-in page with a photograph, and nothing here can produce one. This
       is for the gap that path leaves: somebody who walked out at the end of a
       long night without clocking out, whose arrival would otherwise sit open
       in the log forever. `shiftsFrom` reports those rather than guessing an
       end time, and this is how a manager closes one.

       It carries their username, and `source: "pad"` marks it as a record
       somebody made rather than one somebody took. A row without a photograph
       should never be mistaken for a row with one. */
    if (what === "punch") {
      const employee = await getEmployee(orgId, body.employeeId);
      if (!employee || employee.archived) return res.status(404).json({ error: "noperson" });

      const branch = effectiveBranches([String(body.branchId || "")], scope.authorized);
      const out = await punch(orgId, {
        employeeId: employee.id,
        branchId: branch[0] || employee.branchId || null,
        actor: session.username,
        source: "pad",
      });

      await recordAudit(orgId, {
        actor: session.username,
        action: `staff.${out.kind}`,
        target: employee.id,
        detail: { name: employee.name, branchId: out.punch.branchId, at: out.punch.at },
      });

      /* The same notice the public page sends. An arrival is an arrival
         whichever door it came through, and a manager who is told about one
         and not the other learns not to trust either. Not awaited, for the
         reason it is not awaited there. */
      notifyManagers(scope.org, punchMail({
        name: employee.name,
        title: employee.title,
        kind: out.kind,
        at: out.punch.at,
        branchName: branchNames[String(out.punch.branchId)] || "",
        business: scope.org?.name || session.account?.business || "",
        link: `${publicOrigin(req)}/#/app/employees`,
      })).catch((err) => console.error("[attendance] notify failed:", err.message));

      return res.status(200).json({
        name: employee.name,
        title: employee.title,
        kind: out.kind,
        at: out.punch.at,
        since: out.since,
        workedMs: out.workedMs,
      });
    }

    if (what === "add") {
      const out = await addEmployee(orgId, {
        name: body.name, title: body.title, branchId: body.branchId,
      });
      if (out.error) return res.status(400).json({ error: out.error });
      await recordAudit(orgId, {
        actor: session.username, action: "staff.add", target: out.employee.id,
        detail: { name: out.employee.name, branchId: out.employee.branchId },
      });
      return res.status(200).json({ employee: publicOf(out.employee) });
    }

    if (what === "update") {
      const out = await updateEmployee(orgId, body.id, body);
      if (out.error) return res.status(404).json({ error: out.error });
      return res.status(200).json({ employee: publicOf(out.employee) });
    }


    /* Take a photograph off a punch, and leave the punch.

       Those are two different things. The punch is a ledger entry — somebody's
       hours come out of it, and like every ledger here it is appended and
       never edited. The photograph is evidence attached to it, taken on a
       personal phone inside a workplace, and an owner should be able to clear
       one without silently deleting the shift it belongs to.

       So `photo: true` stays on the punch afterwards and the row reads "photo
       removed", rather than becoming indistinguishable from a punch that never
       had a picture. Somebody looking at an old day can tell the difference
       between no evidence and evidence that was taken away. */
    if (what === "unphoto") {
      const id = String(body.id || "");
      const row = (await listPunches(orgId)).find((p) => p.id === id);
      if (!row) return res.status(404).json({ error: "nophoto" });

      await removePhoto(orgId, id);
      await recordAudit(orgId, {
        actor: session.username,
        action: "staff.photo.remove",
        target: row.employeeId,
        detail: { punchId: id, at: row.at },
      });
      return res.status(200).json({ removed: id });
    }

    /* A new link, and the old one dead in the same breath.

       This is what you press when somebody leaves. The key is a bearer
       credential — whoever holds the link can record a punch — so a person
       walking out with it in their phone is the case it exists for, and a
       link that kept working for another hour would not be a rotation.

       Everyone still on the rota needs the new link, which is the real cost
       and the reason this is a button rather than something automatic. */
    if (what === "rotatekey") {
      const key = await rotateClockKey(orgId);
      await recordAudit(orgId, {
        actor: session.username, action: "staff.rotatekey", target: orgId, detail: {},
      });
      return res.status(200).json({ clockInUrl: `${publicOrigin(req)}/#/attendance/${key}` });
    }

    /* Whether an arrival is worth an email.

       Here rather than in the notification preferences in Settings, because
       those are read in the browser and describe one person's bell — this one
       is the organization's, it is read on the server, and the screen it
       belongs to is this one. */
    if (what === "settings") {
      const org = scope.org;
      if (!org) return res.status(403).json({ error: "noorg" });

      if (body.staffMail !== undefined) org.staffMail = body.staffMail !== false;
      await saveOrg(org);

      await recordAudit(orgId, {
        actor: session.username,
        action: "staff.settings",
        target: orgId,
        detail: { staffMail: org.staffMail !== false },
      });

      return res.status(200).json({ staffMail: org.staffMail !== false });
    }

    if (what === "archive") {
      const out = await archiveEmployee(orgId, body.id, { archived: body.archived !== false });
      if (out.error) return res.status(404).json({ error: out.error });
      await recordAudit(orgId, {
        actor: session.username,
        action: out.employee.archived ? "staff.archive" : "staff.restore",
        target: out.employee.id,
        detail: { name: out.employee.name },
      });
      return res.status(200).json({ employee: publicOf(out.employee) });
    }

    return res.status(400).json({ error: "what" });
  } catch (err) {
    console.error("employees endpoint failed:", err);
    return res.status(500).json({ error: "server" });
  }
}

/* An employee as the browser is allowed to see one. */
function publicOf(e) {
  return { id: e.id, name: e.name, title: e.title, branchId: e.branchId, archived: e.archived };
}
