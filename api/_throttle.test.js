/* Sign-in throttling.

   What these protect: an account password can't be guessed at machine speed;
   a correct password ends the run; the window is measured from the first
   failure so a slow trickle can't hold somebody out forever; an expired
   record clears itself; and the identifier is matched case-insensitively so
   changing capitalisation isn't a way around the count. */

import assert from "node:assert/strict";
import { backend, __resetMemory } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

const th = await import("./_throttle.js");

let failures = 0;
async function test(name, fn) {
  __resetMemory();
  try {
    await fn();
    console.log("  ok ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}

await test("a fresh identifier is not locked", async () => {
  const state = await th.lockState("owner@example.com");
  assert.equal(state.locked, false);
  assert.equal(state.failures, 0);
});

await test("locks only once the ceiling is reached", async () => {
  let state;
  for (let i = 0; i < th.LOCKOUT_MAX_FAILURES - 1; i += 1) {
    state = await th.noteFailure("owner@example.com");
    assert.equal(state.locked, false, `should still be open after ${i + 1} failures`);
  }
  state = await th.noteFailure("owner@example.com");
  assert.equal(state.locked, true, "the last allowed failure must close the door");
  assert.equal(state.failures, th.LOCKOUT_MAX_FAILURES);
});

await test("a lockout is visible to a later read", async () => {
  for (let i = 0; i < th.LOCKOUT_MAX_FAILURES; i += 1) await th.noteFailure("a@b.c");
  const state = await th.lockState("a@b.c");
  assert.equal(state.locked, true);
  assert.ok(state.retryInMs > 0, "a locked identifier must report when to come back");
});

await test("a correct password clears the run", async () => {
  for (let i = 0; i < th.LOCKOUT_MAX_FAILURES - 1; i += 1) await th.noteFailure("a@b.c");
  await th.clearFailures("a@b.c");
  const state = await th.lockState("a@b.c");
  assert.equal(state.failures, 0, "a success must not leave the count behind");
  assert.equal(state.locked, false);
});

await test("the window runs from the first failure, not the last", async () => {
  const t0 = Date.now();
  const first = await th.noteFailure("a@b.c", t0);
  const later = await th.noteFailure("a@b.c", t0 + 60_000);
  assert.equal(later.failures, 2);
  assert.ok(
    later.retryInMs < first.retryInMs,
    "a further guess must not push the unlock time back",
  );
});

await test("an expired record clears itself and starts clean", async () => {
  const t0 = Date.now();
  for (let i = 0; i < th.LOCKOUT_MAX_FAILURES; i += 1) await th.noteFailure("a@b.c", t0);
  assert.equal((await th.lockState("a@b.c", t0)).locked, true);

  const after = t0 + th.LOCKOUT_WINDOW_MS + 1;
  const state = await th.lockState("a@b.c", after);
  assert.equal(state.locked, false, "the window must not outlive itself");
  assert.equal(state.failures, 0);

  const next = await th.noteFailure("a@b.c", after);
  assert.equal(next.failures, 1, "counting must restart, not resume");
});

await test("capitalisation is not a way around the count", async () => {
  await th.noteFailure("Owner@Example.com");
  const state = await th.lockState("owner@example.com");
  assert.equal(state.failures, 1, "the same address in another case is the same address");
});

await test("surrounding space is not a way around the count", async () => {
  await th.noteFailure("  owner@example.com  ");
  const state = await th.lockState("owner@example.com");
  assert.equal(state.failures, 1);
});

await test("an empty identifier is ignored rather than counted", async () => {
  const state = await th.noteFailure("");
  assert.equal(state.locked, false);
  assert.equal(state.failures, 0);
});

await test("retryAfterSeconds never advises coming back immediately", () => {
  assert.equal(th.retryAfterSeconds(0), 1);
  assert.equal(th.retryAfterSeconds(1), 1);
  assert.equal(th.retryAfterSeconds(1500), 2);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
