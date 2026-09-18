/* Attendance: who was here, and for how long.

   ── What has to hold ─────────────────────────────────────────────────────

   A punch decides its own direction, and a record survives the person
   leaving. Everything else is arrangement.

   The first is the one worth stating. There is no "in" button and no "out"
   button anywhere in this product, because the ledger already knows which a
   person is due — and asking is how somebody at the end of a twelve-hour
   shift taps the wrong one and the hours come out as a minute.

   There used to be a six-digit PIN here and four tests about it. It is gone,
   along with the pad it was typed into: a shift is recorded from a keyed
   link now, with a photograph. `_clockkey.test.js` and `_attendance.test.js`
   cover what replaced it. */

import assert from "node:assert/strict";
import {
  addEmployee, listEmployees, archiveEmployee, updateEmployee, getEmployee,
  punch, listPunches, onShift, shiftsFrom,
} from "./_employees.js";

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log("  ok ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}

await test("adding somebody stores a name and issues nothing", async () => {
  const out = await addEmployee("o1", { name: "Maria Santos", title: "Chef de partie" });
  assert.equal(out.error, undefined);
  assert.equal(out.employee.name, "Maria Santos");

  /* There is nothing to hand over any more, and nothing secret on the record.
     If a `pin` or a `pinHash` ever comes back here again it means the code
     has been reintroduced without the file that explained why it went. */
  assert.equal(out.pin, undefined);
  const [stored] = await listEmployees("o1");
  assert.equal(stored.pinHash, undefined);
  assert.equal(stored.pin, undefined);
});

await test("somebody who has left is still resolvable by id", async () => {
  const e = await addEmployee("o6", { name: "Priya" });
  await archiveEmployee("o6", e.employee.id);

  /* The clock-in page has to tell "no such person" apart from "somebody who
     has left" — it refuses both, with one answer, and it can only do that if
     the record is still there to look at. */
  const found = await getEmployee("o6", e.employee.id);
  assert.equal(found.name, "Priya");
  assert.equal(found.archived, true);
  assert.equal(await getEmployee("o6", "nobody"), null);
});

await test("the same name twice is refused", async () => {
  await addEmployee("o5", { name: "Ahmed" });
  assert.equal((await addEmployee("o5", { name: "  ahmed  " })).error, "duplicate");
  assert.equal((await addEmployee("o5", { name: "   " })).error, "name");
});

await test("archiving keeps the record, because old punches point at it", async () => {
  const e = await addEmployee("o8", { name: "Yusuf" });
  await punch("o8", { employeeId: e.employee.id, branchId: "b1" });
  await archiveEmployee("o8", e.employee.id);

  assert.equal((await listEmployees("o8")).length, 0, "off the roster");
  assert.equal((await listEmployees("o8", { includeArchived: true })).length, 1, "still resolvable");
  assert.equal((await listPunches("o8")).length, 1, "and their punch is still there");
});

/* ── Punching ───────────────────────────────────────────────────────────── */

await test("a punch decides its own direction", async () => {
  const e = await addEmployee("o9", { name: "Hassan" });
  const id = e.employee.id;

  const first = await punch("o9", { employeeId: id, branchId: "b1" });
  assert.equal(first.kind, "in", "the first of the day is an arrival");

  const second = await punch("o9", { employeeId: id, branchId: "b1" });
  assert.equal(second.kind, "out");

  const third = await punch("o9", { employeeId: id, branchId: "b1" });
  assert.equal(third.kind, "in", "back from a break is back in");
});

await test("a departure reports how long the shift ran", async () => {
  const e = await addEmployee("o10", { name: "Nadia" });
  const id = e.employee.id;
  const start = Date.now() - 7 * 3600_000 - 20 * 60_000;

  await punch("o10", { employeeId: id, branchId: "b1", at: start });
  const out = await punch("o10", { employeeId: id, branchId: "b1", at: start + 7 * 3600_000 + 20 * 60_000 });

  assert.equal(out.kind, "out");
  assert.equal(out.workedMs, 7 * 3600_000 + 20 * 60_000);
  assert.equal(out.since, start, "and when it started");
});

await test("who is on shift is derived, never stored", async () => {
  const a = await addEmployee("o11", { name: "A" });
  const b = await addEmployee("o11", { name: "B" });
  const c = await addEmployee("o11", { name: "C" });

  await punch("o11", { employeeId: a.employee.id, at: 1000 });
  await punch("o11", { employeeId: b.employee.id, at: 2000 });
  await punch("o11", { employeeId: c.employee.id, at: 3000 });
  await punch("o11", { employeeId: b.employee.id, at: 4000 });

  const here = onShift(await listPunches("o11")).map((p) => p.employeeId).sort();
  assert.deepEqual(here, [a.employee.id, c.employee.id].sort(), "B went home");
});

await test("punches are per organization", async () => {
  const e = await addEmployee("o12", { name: "Solo" });
  await punch("o12", { employeeId: e.employee.id, at: 1000 });
  assert.equal((await listPunches("o13")).length, 0);
});

await test("a window and a person narrow the log", async () => {
  const e = await addEmployee("o14", { name: "Kareem" });
  const id = e.employee.id;
  await punch("o14", { employeeId: id, at: 1000, branchId: "b1" });
  await punch("o14", { employeeId: id, at: 5000, branchId: "b1" });
  await punch("o14", { employeeId: "someone-else", at: 3000, branchId: "b2" });

  assert.equal((await listPunches("o14", { from: 2000 })).length, 2);
  assert.equal((await listPunches("o14", { employeeId: id })).length, 2);
  assert.equal((await listPunches("o14", { branchId: "b2" })).length, 1);
});

/* ── Shifts ─────────────────────────────────────────────────────────────── */

await test("a completed stretch of work comes out as one shift", () => {
  const shifts = shiftsFrom([
    { employeeId: "e1", branchId: "b1", kind: "in", at: 1000 },
    { employeeId: "e1", branchId: "b1", kind: "out", at: 9000 },
  ]);
  assert.equal(shifts.length, 1);
  assert.deepEqual(
    { in: shifts[0].in, out: shifts[0].out, ms: shifts[0].ms },
    { in: 1000, out: 9000, ms: 8000 },
  );
});

await test("somebody who forgot to punch out is shown, not paid", () => {
  /* The honest failure. Pairing an unmatched arrival with the next day's
     departure would produce a thirty-hour shift that looks like a number
     rather than a mistake — so it is left open and reported open. */
  const shifts = shiftsFrom([
    { employeeId: "e1", kind: "in", at: 1000 },
    { employeeId: "e1", kind: "in", at: 90000 },
    { employeeId: "e1", kind: "out", at: 95000 },
  ]);
  assert.equal(shifts.length, 2);
  const unfinished = shifts.find((sh) => sh.out === null);
  assert.ok(unfinished, "the forgotten one is there");
  assert.equal(unfinished.in, 1000);
  assert.equal(unfinished.ms, null, "and carries no duration to pay on");
});

await test("a departure with no arrival is reported the same way", () => {
  const shifts = shiftsFrom([{ employeeId: "e1", kind: "out", at: 9000 }]);
  assert.equal(shifts.length, 1);
  assert.equal(shifts[0].in, null);
  assert.equal(shifts[0].ms, null);
});

await test("two people's shifts do not run into each other", () => {
  const shifts = shiftsFrom([
    { employeeId: "e1", kind: "in", at: 1000 },
    { employeeId: "e2", kind: "in", at: 2000 },
    { employeeId: "e1", kind: "out", at: 3000 },
    { employeeId: "e2", kind: "out", at: 4000 },
  ]);
  assert.equal(shifts.length, 2);
  assert.equal(shifts.find((sh) => sh.employeeId === "e1").ms, 2000);
  assert.equal(shifts.find((sh) => sh.employeeId === "e2").ms, 2000);
});

await test("editing somebody keeps everything not edited", async () => {
  const e = await addEmployee("o15", { name: "Omar", title: "Runner" });
  await updateEmployee("o15", e.employee.id, { title: "Head waiter", branchId: "b2" });

  const [after] = await listEmployees("o15");
  assert.equal(after.name, "Omar", "a name nobody edited is not blanked");
  assert.equal(after.title, "Head waiter");
  assert.equal(after.branchId, "b2");
  assert.equal(after.id, e.employee.id, "and it is the same record");
});

await test("a punch records which door it came through", async () => {
  const e = await addEmployee("o16", { name: "Grace" });

  /* A shift somebody photographed and a shift a manager typed are not worth
     the same, and the row a manager reads has to be able to say which. */
  const web = await punch("o16", { employeeId: e.employee.id, source: "web", photo: true });
  assert.equal(web.punch.source, "web");
  assert.equal(web.punch.photo, true);
  assert.equal(web.punch.actor, "", "nobody was signed in");

  const byHand = await punch("o16", { employeeId: e.employee.id, actor: "owner" });
  assert.equal(byHand.punch.source, "pad", "anything not web is a record somebody made");
  assert.equal(byHand.punch.photo, false);
  assert.equal(byHand.punch.actor, "owner");
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
