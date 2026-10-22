/* The viewport the app runs under.

   Worth a test because the failure is only visible on a phone, after a tap:
   iOS zooms into a field with small text and never zooms back out, and the
   whole app is wider than the screen from then on. Nothing on a desktop
   browser, and nothing in the simulator until somebody taps the right field. */

import assert from "node:assert/strict";
import { lockedViewport } from "./shell.js";

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log("  ok  ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}

const parts = (content) => content.split(",").map((p) => p.trim());

/* What index.html ships. */
const SHIPPED = "width=device-width, initial-scale=1.0, viewport-fit=cover";

test("the shipped viewport gains the zoom lock", () => {
  const locked = parts(lockedViewport(SHIPPED));
  assert.ok(locked.includes("maximum-scale=1"), "maximum-scale=1 is what stops the focus zoom");
  assert.ok(locked.includes("user-scalable=no"), "and an accidental pinch");
  assert.ok(locked.includes("minimum-scale=1"));
});

test("what was already there survives, viewport-fit above all", () => {
  const locked = parts(lockedViewport(SHIPPED));
  /* Losing viewport-fit=cover zeroes every env(safe-area-inset-*), and the
     headers go back under the clock. */
  for (const keep of ["width=device-width", "initial-scale=1.0", "viewport-fit=cover"]) {
    assert.ok(locked.includes(keep), `kept ${keep}`);
  }
});

test("an existing scale limit is replaced, not left to contradict the new one", () => {
  const locked = parts(lockedViewport("width=device-width, maximum-scale=5, user-scalable=yes"));
  assert.equal(locked.filter((p) => p.startsWith("maximum-scale")).length, 1);
  assert.equal(locked.filter((p) => p.startsWith("user-scalable")).length, 1);
  assert.ok(!locked.includes("maximum-scale=5"));
  assert.ok(!locked.includes("user-scalable=yes"));
});

test("running it twice changes nothing the second time", () => {
  const once = lockedViewport(SHIPPED);
  assert.equal(lockedViewport(once), once);
});

test("a page with no viewport content still gets the lock", () => {
  assert.equal(lockedViewport(""), "minimum-scale=1, maximum-scale=1, user-scalable=no");
  assert.equal(lockedViewport(), "minimum-scale=1, maximum-scale=1, user-scalable=no");
});

if (failures) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nall passed");
