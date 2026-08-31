import assert from "node:assert/strict";
import { buildNotices, noticesApply, NOTICE_NEEDS } from "./notices.js";

const t = { notices: Object.fromEntries(
  ["firstTitle","firstBody","peakTitle","peakBody","marginTitle","marginBody","eodTitle","eodBody",
   "swingUpTitle","swingDownTitle","swingBody","weeklyTitle","weeklyBody","ordersTitle","ordersBody",
   "goalTitle","goalBody","targetTitle","targetBody"].map((k) => [k, k])) };
const data = { totals: { peakHour: "19:00", marginPct: 40, salesDelta: 30 }, today: { receipts: 12 } };
const run = (caps) => buildNotices(data, {}, { t, fill: (s) => s, capabilities: caps }).map((n) => n.key);

let bad = 0;
const ok = (name, fn) => { try { fn(); console.log("  ok  " + name); } catch (e) { bad++; console.error("  FAIL " + name + "\n        " + e.message); } };

ok("every notice declares who it is for", () => {
  for (const k of Object.keys(NOTICE_NEEDS)) assert.ok(NOTICE_NEEDS[k], k);
});
ok("a cashier receives nothing", () => assert.deepEqual(run(["view:dashboard"]), []));
ok("a chef receives nothing", () => assert.deepEqual(run(["view:inventory","manage:recipes"]), []));
ok("neither has a bell", () => {
  assert.equal(noticesApply(["view:dashboard"]), false);
  assert.equal(noticesApply(["view:inventory"]), false);
});
ok("a branch manager does", () => {
  assert.ok(run(["view:dashboard","view:reports","view:profitability"]).length > 0);
  assert.equal(noticesApply(["view:reports"]), true);
});
ok("margin is withheld from someone who cannot see margin", () => {
  assert.ok(!run(["view:reports"]).includes("alertMargin"));
  assert.ok(run(["view:reports","view:profitability"]).includes("alertMargin"));
});
ok("no capabilities given means unrestricted", () => {
  assert.ok(buildNotices(data, {}, { t, fill: (s) => s }).length > 0);
});
console.log(bad ? `\n${bad} failed` : "\nall passed");
process.exit(bad ? 1 : 0);
