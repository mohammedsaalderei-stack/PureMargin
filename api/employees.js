/* Staff and attendance over HTTP.

   GET  ?what=roster[&branches=a,b]  — who works here, who is on shift, today's punches
        ?what=log&from=&to=          — completed shifts in a window
   POST ?what=add     { name, title, branchId }      — issues a PIN, once
        ?what=rotate  { id }                         — issues another, once
        ?what=archive { id, archived }
        ?what=punch   { pin, branchId }              — in or out, decided by the ledger
        ?what=update  { id, name, title, branchId }

   ── Why punching is gated differently from the rest ──────────────────────

   Everything that changes the roster needs `manage:staff`. Punching needs the
   PIN and the same signed-in session the screen is already open in — because
   the device at the pass is signed in as whoever opened it, and the person
   arriving is not going to have an account. The PIN is what says which
   employee; the session is what says which organization's roster to look in.

   A punch is deliberately not gated on `manage:staff`. A venue that only lets
   a manager's phone take attendance is a venue where attendance is taken when
   the manager remembers, which is the thing this is meant to replace. */

import { requireAuth } from "./_auth.js";
import { scopeFor, effectiveBranches, parseBranchParam } from "./_org.js";
import { posTokenFor } from "./_accounts.js";
import { branchList } from "./_data.js";
import { recordAudit } from "./_audit.js";
import {
  listEmployees, addEmployee, updateEmployee, rotatePin, archiveEmployee,
  findByPin, listPunches, onShift, punch, shiftsFrom,
} from "./_employees.js";

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
          employees: people.map((e) => ({ id: e.id, name: e.name, title: e.title })),
        });
      }

      const today = (await listPunches(orgId, { from: startOfDay() }))
        .filter((p) => known.has(p.employeeId));

      return res.status(200).json({
        branches,
        branchNames,
        /* Never the hash, and never anything a PIN could be recovered from. */
        employees: people.map((e) => ({
          id: e.id, name: e.name, title: e.title, branchId: e.branchId,
          pinSetAt: e.pinSetAt, archived: e.archived,
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

    /* The one action a person without staff administration may take, because
       the PIN is the authorization and the whole point is that it happens at
       the door rather than in an office. */
    if (what === "punch") {
      const employee = await findByPin(orgId, body.pin);
      /* One answer for a wrong code and for a code belonging to somebody
         archived, so the pad cannot be used to find out which codes exist. */
      if (!employee) return res.status(404).json({ error: "nopin" });

      const branch = effectiveBranches([String(body.branchId || "")], scope.authorized);
      const out = await punch(orgId, {
        employeeId: employee.id,
        branchId: branch[0] || employee.branchId || null,
        actor: session.username,
      });

      await recordAudit(orgId, {
        actor: session.username,
        action: `staff.${out.kind}`,
        target: employee.id,
        detail: { name: employee.name, branchId: out.punch.branchId, at: out.punch.at },
      });

      return res.status(200).json({
        name: employee.name,
        title: employee.title,
        kind: out.kind,
        at: out.punch.at,
        since: out.since,
        workedMs: out.workedMs,
      });
    }

    if (!may("manage:staff")) return res.status(403).json({ error: "forbidden" });

    if (what === "add") {
      const out = await addEmployee(orgId, {
        name: body.name, title: body.title, branchId: body.branchId,
      });
      if (out.error) return res.status(400).json({ error: out.error });
      await recordAudit(orgId, {
        actor: session.username, action: "staff.add", target: out.employee.id,
        detail: { name: out.employee.name, branchId: out.employee.branchId },
      });
      /* The only time the code exists in a response. Nothing stores it and no
         later read can produce it — a lost PIN is rotated, not looked up. */
      return res.status(200).json({ employee: publicOf(out.employee), pin: out.pin });
    }

    if (what === "update") {
      const out = await updateEmployee(orgId, body.id, body);
      if (out.error) return res.status(404).json({ error: out.error });
      return res.status(200).json({ employee: publicOf(out.employee) });
    }

    if (what === "rotate") {
      const out = await rotatePin(orgId, body.id);
      if (out.error) return res.status(404).json({ error: out.error });
      await recordAudit(orgId, {
        actor: session.username, action: "staff.rotate", target: out.employee.id,
        detail: { name: out.employee.name },
      });
      return res.status(200).json({ employee: publicOf(out.employee), pin: out.pin });
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

/* An employee as the browser is allowed to see one: never the hash, and
   nothing a code could be worked back from. */
function publicOf(e) {
  return {
    id: e.id, name: e.name, title: e.title, branchId: e.branchId,
    pinSetAt: e.pinSetAt, archived: e.archived,
  };
}
