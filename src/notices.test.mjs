import assert from "node:assert/strict";
import {
  buildNotices, noticesApply, NOTICE_NEEDS, countUnseen, rememberSeen,
  readPrefs, writePrefs, pastEod, DEFAULT_ALERTS, DEFAULT_EOD,
} from "./notices.js";

/* Body strings carry every placeholder the real dictionary uses, because
   `noticeKey` is `id:body` and the body is where a figure shows up. A stub
   that returned the template unchanged would make "margin at 40%" and "margin
   at 31%" the same string, and the test would pass while the product could not
   tell a worsening margin from a repeated one. */
const t = { notices: Object.fromEntries(
  ["firstTitle","peakTitle","marginTitle","eodTitle","swingUpTitle","swingDownTitle",
   "weeklyTitle","ordersTitle","goalTitle","targetTitle"].map((k) => [k, k])
  .concat(["firstBody","peakBody","marginBody","eodBody","swingBody","weeklyBody",
   "ordersBody","goalBody","targetBody"].map((k) => [k, `${k} {pct}{hour}{orders}{n}`]))) };

/* The real `fill`, near enough: substitute what is given, drop what is not. */
const fill = (s, vars = {}) =>
  String(s).replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? "" : String(vars[k])));

const data = { totals: { peakHour: "19:00", marginPct: 40, salesDelta: 30 }, today: { receipts: 12 } };
const run = (caps) => buildNotices(data, {}, { t, fill, capabilities: caps }).map((n) => n.key);

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
  assert.ok(buildNotices(data, {}, { t, fill }).length > 0);
});

/* ---- the badge, and being able to clear it ---------------------------- */

/* The dashboard re-reads /api/metrics every 30 seconds and calls setData with
   a fresh object, so the bell rebuilds its notices on that cadence. What must
   survive that rebuild is the fact that somebody has already read them. */

const build = (over = {}) => buildNotices(
  { ...data, ...over }, {}, { t, fill });

ok("opening the bell clears the badge, and a refresh does not bring it back", () => {
  const first = build();
  assert.ok(first.length > 0, "fixture should produce notices");

  /* Opened and read. */
  const seen = rememberSeen(first, []);
  assert.equal(countUnseen(first, seen), 0);

  /* Thirty seconds later: same figures, rebuilt from a new object. Nothing
     about the business has changed, so nothing is newly worth saying. */
  const later = build();
  assert.equal(countUnseen(later, seen), 0,
    "a refresh with unchanged figures must not re-raise the badge");
});

ok("a notice whose figure moved counts as new again", () => {
  const seen = rememberSeen(build({ totals: { ...data.totals, marginPct: 40 } }), []);
  /* Margin slipping further is a different statement, not the same one
     repeated — the body carries the number, so it reads as unseen. */
  const worse = build({ totals: { ...data.totals, marginPct: 31 } });
  assert.equal(countUnseen(worse, seen), 1);
});

ok("a genuinely new notice raises the badge on its own", () => {
  const quiet = build({ totals: { peakHour: "19:00", marginPct: 70, salesDelta: 2 } });
  const seen = rememberSeen(quiet, []);
  /* Sales swing past the threshold: one new thing to say, and only one. */
  const swung = build({ totals: { peakHour: "19:00", marginPct: 70, salesDelta: 30 } });
  assert.equal(countUnseen(swung, seen), 1);
});

ok("the seen list cannot grow without bound", () => {
  let seen = [];
  for (let i = 0; i < 500; i++) {
    seen = rememberSeen(build({ totals: { ...data.totals, marginPct: 20 + (i % 20) } }), seen);
  }
  assert.ok(seen.length <= 60, `seen list grew to ${seen.length}`);
});

ok("a corrupt or legacy stored value is ignored rather than throwing", () => {
  const notices = build();
  /* This key used to hold a millisecond timestamp. Somebody upgrading has one
     in localStorage, and it must not crash the bell or hide the badge. */
  assert.equal(countUnseen(notices, 1735689600000), notices.length);
  assert.equal(countUnseen(notices, null), notices.length);
  assert.equal(countUnseen(notices, "nonsense"), notices.length);
  assert.deepEqual(rememberSeen(notices, 1735689600000).length, notices.length);
});

/* ---- the settings round trip ------------------------------------------ */

/* A stand-in for localStorage; `throws` models private mode. */
const store = (initial = {}, throws = false) => {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => { if (throws) throw new Error("denied"); return map.has(k) ? map.get(k) : null; },
    setItem: (k, v) => { if (throws) throw new Error("denied"); map.set(k, String(v)); },
    dump: () => Object.fromEntries(map),
  };
};

ok("the daily target and end-of-day time survive being saved and reopened", () => {
  const s = store();
  writePrefs(s, { alerts: { ...DEFAULT_ALERTS, alertGoal: true }, target: "5000", eodTime: "22:30" });

  /* Reopening Settings. Both boxes used to come back blank and 20:00, and the
     next Save wrote that over the real values. */
  const back = readPrefs(s);
  assert.equal(back.target, "5000");
  assert.equal(back.eodTime, "22:30");
  assert.equal(back.alerts.alertGoal, true);

  /* Flipping an unrelated switch and saving again must not lose them. */
  writePrefs(s, { ...back, alerts: { ...back.alerts, alertPeak: false } });
  assert.equal(readPrefs(s).target, "5000");
  assert.equal(readPrefs(s).eodTime, "22:30");
});

ok("a wiped target switches the target notices off — the bug, stated", () => {
  const withTarget = buildNotices(
    { totals: { marginPct: 70 }, today: { sales: 6000, receipts: 20 } },
    { alertGoal: true }, { t, fill, dailyTarget: "5000" });
  assert.ok(withTarget.some((n) => n.id === "goal"), "target met should fire");

  const wiped = buildNotices(
    { totals: { marginPct: 70 }, today: { sales: 6000, receipts: 20 } },
    { alertGoal: true }, { t, fill, dailyTarget: "" });
  assert.ok(!wiped.some((n) => n.id === "goal"),
    "with the target blanked, the notice cannot fire — which is what saving used to cause");
});

ok("the end-of-day time defaults the same way in both places", () => {
  /* Settings displayed 20:00 while the bell read "" and pastEod("") is always
     false, so the summary never arrived for anyone who had not pressed Save.
     One default now, and it is a time the bell can act on. */
  assert.equal(readPrefs(store()).eodTime, DEFAULT_EOD);
  assert.equal(pastEod(readPrefs(store()).eodTime, new Date("2026-09-01T21:00:00")), true);
  assert.equal(pastEod(readPrefs(store()).eodTime, new Date("2026-09-01T11:00:00")), false);
});

ok("switches default to on so a fresh account is not silently muted", () => {
  const fresh = readPrefs(store());
  assert.equal(fresh.alerts.alertEod, true);
  assert.equal(fresh.alerts.alertMargin, true);
  /* Except the two that would be noise. */
  assert.equal(fresh.alerts.alertOrder, false);
});

ok("a corrupt preferences blob falls back to the defaults rather than throwing", () => {
  assert.deepEqual(readPrefs(store({ sufra_alerts: "not json" })).alerts, DEFAULT_ALERTS);
  assert.deepEqual(readPrefs(store({ sufra_alerts: "[1,2]" })).alerts, DEFAULT_ALERTS);
  assert.equal(readPrefs(store({ sufra_eod: "banana" })).eodTime, DEFAULT_EOD);
  assert.equal(readPrefs(store({ sufra_eod: "99:99" })).eodTime, DEFAULT_EOD);
});

ok("private mode is survivable in both directions", () => {
  const denied = store({}, true);
  assert.deepEqual(readPrefs(denied).alerts, DEFAULT_ALERTS);
  assert.equal(readPrefs(denied).eodTime, DEFAULT_EOD);
  assert.equal(writePrefs(denied, { alerts: DEFAULT_ALERTS, target: "1", eodTime: "20:00" }), false);
  assert.deepEqual(readPrefs(null).alerts, DEFAULT_ALERTS);
});

console.log(bad ? `\n${bad} failed` : "\nall passed");
process.exit(bad ? 1 : 0);
