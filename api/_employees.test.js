/* Attendance: who was here, worked out from what they typed.

   ── The two things that must hold ────────────────────────────────────────

   A PIN identifies exactly one person, and a punch decides its own direction.
   Everything else on the screen is arrangement; those two are what make the
   record mean anything.

   The second is the one worth stating. There is no "in" button and no "out"
   button, because the ledger already knows which a person is due — and a pad
   that asks is a pad where somebody at the end of a twelve-hour shift taps the
   wrong one and the hours come out as a minute. */

import assert from "node:assert/strict";
import {
  addEmployee, listEmployees, rotatePin, archiveEmployee, updateEmployee,
  findByPin, punch, listPunches, onShift, shiftsFrom, hashPin,
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

await test("adding somebody issues a code, once", async () => {
  const out = await addEmployee("o1", { name: "Maria Santos", title: "Chef de partie" });
  assert.equal(out.error, undefined);
  assert.match(out.pin, /^\d{6}$/, "six digits");
  assert.equal(out.employee.name, "Maria Santos");

  /* Nothing stores it in a readable form, so nothing can hand it back. That is
     what forces a lost code to be rotated rather than looked up — and rotation
     is the only thing that actually stops a code that has been passed on. */
  const [stored] = await listEmployees("o1");
  assert.equal(stored.pin, undefined);
  assert.ok(stored.pinHash, "only the hash is kept");
  assert.notEqual(stored.pinHash, out.pin);
  assert.equal(stored.pinHash, hashPin("o1", out.pin));
});

await test("a code finds its own person and nobody else's", async () => {
  const a = await addEmployee("o2", { name: "Ali" });
  const b = await addEmployee("o2", { name: "Bilal" });
  assert.notEqual(a.pin, b.pin, "two people never share a code");

  assert.equal((await findByPin("o2", a.pin)).name, "Ali");
  assert.equal((await findByPin("o2", b.pin)).name, "Bilal");
  assert.equal(await findByPin("o2", "000000"), null);
  assert.equal(await findByPin("o2", ""), null);
  assert.equal(await findByPin("o2", "abc"), null);
});

await test("a code is an organization's own", async () => {
  /* The same digits at another business must not resolve to anybody. The
     org id is part of the hash for exactly this. */
  const a = await addEmployee("o3", { name: "Sam" });
  assert.ok(await findByPin("o3", a.pin));
  assert.equal(await findByPin("o4", a.pin), null);
});

await test("the same name twice is refused", async () => {
  await addEmployee("o5", { name: "Ahmed" });
  assert.equal((await addEmployee("o5", { name: "  ahmed  " })).error, "duplicate");
  assert.equal((await addEmployee("o5", { name: "   " })).error, "name");
});

await test("rotating replaces the code and nothing else", async () => {
  const first = await addEmployee("o6", { name: "Priya", title: "Server" });
  const again = await rotatePin("o6", first.employee.id);

  assert.notEqual(again.pin, first.pin);
  assert.equal(again.employee.name, "Priya");
  assert.equal(again.employee.title, "Server", "the person is untouched");

  assert.equal(await findByPin("o6", first.pin), null, "the old code stops working");
  assert.equal((await findByPin("o6", again.pin)).name, "Priya");
});

await test("an archived person's code stops working, and is not reissued", async () => {
  const gone = await addEmployee("o7", { name: "Leaver" });
  await archiveEmployee("o7", gone.employee.id);
  assert.equal(await findByPin("o7", gone.pin), null);

  /* Their code stays reserved. A punch resolves by hash and cannot tell that
     its owner left, so handing the same digits to somebody new would file one
     person's arrival under another's name. */
  for (let i = 0; i < 40; i += 1) {
    const fresh = await addEmployee("o7", { name: `New ${i}` });
    assert.notEqual(fresh.pin, gone.pin);
  }
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

await test("editing somebody does not disturb their code", async () => {
  const e = await addEmployee("o15", { name: "Omar", title: "Runner" });
  await updateEmployee("o15", e.employee.id, { title: "Head waiter", branchId: "b2" });

  const [after] = await listEmployees("o15");
  assert.equal(after.title, "Head waiter");
  assert.equal(after.branchId, "b2");
  assert.equal((await findByPin("o15", e.pin)).id, e.employee.id, "same code, same person");
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
