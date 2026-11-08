/* Every screen has exactly one home, and nobody is shown a door they cannot open. */
import assert from "node:assert/strict";
import { PORTALS, ACCOUNT, layoutFor, portalOf, landingOf } from "./nav.js";
import { SCREEN_FEATURE } from "./entitlements.js";

let failures = 0;
const test = (name, fn) => { try { fn(); console.log("  ok ", name); } catch (err) { failures += 1; console.error("  FAIL", name, "\n       ", err.message); } };

const placed = [...PORTALS.flatMap((p) => [...p.primary, ...p.more]), ...ACCOUNT];
const screens = [...Object.keys(SCREEN_FEATURE), "employees"];

test("every screen the app has is placed somewhere", () => {
  const missing = screens.filter((id) => !placed.includes(id));
  assert.deepEqual(missing, []);
});

test("no screen is placed twice", () => {
  const twice = placed.filter((id, i) => placed.indexOf(id) !== i);
  assert.deepEqual(twice, []);
});

test("nothing is placed that the app does not have", () => {
  assert.deepEqual(placed.filter((id) => !screens.includes(id)), []);
});

test("at most four essentials per portal, so the bar holds five with More", () => {
  for (const p of PORTALS) assert.ok(p.primary.length <= 4, p.id);
});

test("a cashier sees the register and nothing of the back office they cannot open", () => {
  const layout = layoutFor(["till", "ask", "settings", "sales", "costs"]);
  assert.deepEqual(layout.map((p) => p.id), ["business", "register"]);
  assert.deepEqual(layout[0].primary, ["sales", "costs", "ask"]);
});

test("a portal with only 'more' screens open shows them as its essentials", () => {
  const layout = layoutFor(["variance"]);
  assert.deepEqual(layout, [{ id: "kitchen", primary: ["variance"], more: [] }]);
});

test("a portal lands on its first open screen", () => {
  const layout = layoutFor(["recipes", "alerts"]);
  assert.equal(landingOf(layout, "kitchen"), "recipes");
  assert.equal(portalOf("till"), "register");
  assert.equal(portalOf("settings"), null);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
