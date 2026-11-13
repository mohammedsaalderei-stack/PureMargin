/* Profit purity (`pureScore` in `_margin.js`).

   What this protects: the score reads GROSS margin, which for a restaurant
   is normally 60–75%. Its bounds used to be 12% and 30% — net-margin
   numbers — so every kitchen got full marks for margin, a missing earlier
   period was scored as flat trade, and the ring read 83 for nearly everyone.
   These pin the bounds to food cost (55% → nothing, 70% → full), keep a
   business with no earlier period from being handed a neutral trend, and
   keep the refusal to score a menu that is barely costed.

   Pure: no store, nothing to reset. */

import assert from "node:assert/strict";
import { pureScore } from "./_margin.js";

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

/* What `_aggregate.js` hands the margin layer, trimmed to what it reads. */
const metrics = ({ margin, delta = null, coverage = 100 }) => ({
  costCoverage: coverage,
  totals: { costedMarginPct: margin, marginPct: margin, salesDelta: delta },
});
const score = (opts) => pureScore(metrics(opts));

test("a 55% and a 75% gross margin no longer score the same", () => {
  const thin = score({ margin: 55, delta: 0 });
  const good = score({ margin: 75, delta: 0 });
  assert.ok(good.value > thin.value, `75% margin scored ${good.value}, 55% scored ${thin.value}`);
  assert.equal(thin.marginPart, 0, "45% food cost earns nothing for margin");
  assert.equal(good.marginPart, 1, "25% food cost earns full marks");
});

test("the margin half runs from 55% (food cost 45%) to 70% (food cost 30%)", () => {
  assert.equal(score({ margin: 55 }).value, 0);
  assert.equal(score({ margin: 62.5 }).value, 50, "half way is half marks");
  assert.equal(score({ margin: 70 }).value, 100);
  assert.equal(score({ margin: 69 }).value, 93, "just short of the target is not full marks");
  assert.equal(score({ margin: 31 }).value, 0, "31% gross is a kitchen in trouble, not a full score");
  assert.equal(score({ margin: 90 }).value, 100, "capped, not above 100");
});

test("no earlier period: scored on margin alone, and says so", () => {
  const s = score({ margin: 70, delta: null });
  assert.equal(s.value, 100, "no neutral trend invented (it used to read 83 here)");
  assert.equal(s.noTrend, true);
  assert.equal(s.trendPart, null, "no trend is not a trend of one half");
  /* Built by hand: the helper's default would turn an absent delta into null. */
  const absent = pureScore({ costCoverage: 100, totals: { costedMarginPct: 70 } });
  assert.equal(absent.noTrend, true, "an absent delta is no trend too");
  assert.equal(score({ margin: 70, delta: Number.NaN }).noTrend, true, "nor is a delta that isn't a number");
  const withTrend = score({ margin: 70, delta: 0 });
  assert.equal(withTrend.noTrend, false, "a delta of 0 is flat trade, which is a trend");
  assert.equal(withTrend.trendPart, 0.5);
});

test("growth lifts the score and decline lowers it", () => {
  const down = score({ margin: 70, delta: -10 });
  const flat = score({ margin: 70, delta: 0 });
  const up = score({ margin: 70, delta: 10 });
  assert.ok(down.value < flat.value && flat.value < up.value, `${down.value} / ${flat.value} / ${up.value}`);
  assert.equal(down.value, 74, "65 for margin + 0.25 × 35");
  assert.equal(up.value, 91, "65 for margin + 0.75 × 35");
  assert.equal(score({ margin: 70, delta: 60 }).value, 100, "one freak month caps at +20%");
  assert.equal(score({ margin: 70, delta: -60 }).value, 65, "and at −20%");
});

test("the state words follow the value", () => {
  assert.equal(score({ margin: 70 }).state, "strong");
  assert.equal(score({ margin: 63 }).state, "steady");
  assert.equal(score({ margin: 60 }).state, "watch");
  assert.equal(score({ margin: 56 }).state, "weak");
});

test("below 25% of turnover costed there is no score", () => {
  const none = score({ margin: 70, delta: 0, coverage: 24 });
  assert.equal(none.value, null);
  assert.equal(none.state, "nocost");
  assert.equal(score({ margin: 70, delta: 0, coverage: 25 }).value, 83, "25% costed is enough to score");
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
