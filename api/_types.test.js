/* Business type, and the one thing it must never be allowed to do.

   Type controls presentation. The specification says so and `_types.js` says
   so, and the reason it needs a test rather than a comment is that the wrong
   version of this feature is easy to write and looks right: four types with
   four feature lists, where picking "home business" quietly removes purchasing
   and variance. That is a permission decision wearing a preference's clothes,
   and the person it happens to has no way to tell they have lost something.

   So the assertions below are mostly negative. A type may promote a tab. It
   may not add one, remove one, or invent one. */

import assert from "node:assert/strict";
import {
  BUSINESS_TYPES, normaliseType, priorityFor, orderTabs, availableFeatures,
} from "./_types.js";

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log("  ok ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}

const PERMITTED = ["overview", "costs", "ask", "inventory", "recipes", "sales", "settings"];

test("reordering keeps exactly the tabs it was given", () => {
  for (const type of BUSINESS_TYPES) {
    const out = orderTabs(type, PERMITTED);
    assert.deepEqual(
      [...out].sort(), [...PERMITTED].sort(),
      `${type} changed the set, not just the order`);
  }
});

test("a type cannot grant a tab the role does not allow", () => {
  /* A cashier: no recipes, no sales screen, no overview. Every type's priority
     names at least one of those, and not one of them may appear. */
  const cashier = ["costs", "ask", "settings"];
  for (const type of BUSINESS_TYPES) {
    const out = orderTabs(type, cashier);
    assert.deepEqual([...out].sort(), [...cashier].sort(), `${type} widened a cashier's nav`);
  }
});

test("a type cannot take a tab away", () => {
  for (const type of BUSINESS_TYPES) {
    const out = orderTabs(type, PERMITTED);
    for (const id of PERMITTED) {
      assert.ok(out.includes(id), `${type} dropped ${id}`);
    }
  }
});

test("each type leads with something different", () => {
  const leads = BUSINESS_TYPES.map((type) => orderTabs(type, PERMITTED)[0]);
  /* If every type opened on the same screen the feature would be doing
     nothing, which is worth failing over rather than shipping as a no-op. */
  assert.ok(new Set(leads).size > 1, `every type led with ${leads[0]}`);

  assert.equal(orderTabs("home_business", PERMITTED)[0], "recipes");
  assert.equal(orderTabs("cafe", PERMITTED)[0], "sales");
  assert.equal(orderTabs("food_truck", PERMITTED)[0], "sales");
  assert.equal(orderTabs("restaurant", PERMITTED)[0], "overview");
});

test("no type means the order it has always had", () => {
  /* Every account that predates the question has a null type, and rearranging
     their nav because a deploy happened is not a decision this code gets to
     make. */
  assert.deepEqual(orderTabs(null, PERMITTED), PERMITTED);
  assert.deepEqual(orderTabs(undefined, PERMITTED), PERMITTED);
  assert.deepEqual(orderTabs("", PERMITTED), PERMITTED);
  assert.deepEqual(priorityFor(null), []);
});

test("a value nobody recognises is treated as no answer", () => {
  assert.equal(normaliseType("bakery"), null);
  assert.equal(normaliseType("RESTAURANT "), "restaurant");
  assert.deepEqual(orderTabs("bakery", PERMITTED), PERMITTED);
});

test("the legacy values the mobile client may hold are migrated", () => {
  /* §7 names these as already in the wild. Rejecting them would silently
     reorder somebody's nav back to the default for no visible reason. */
  assert.equal(normaliseType("home"), "home_business");
  assert.equal(normaliseType("truck"), "food_truck");
  assert.equal(normaliseType("home_business"), "home_business");
});

test("an empty nav stays empty", () => {
  for (const type of BUSINESS_TYPES) assert.deepEqual(orderTabs(type, []), []);
});

/* ── What the client is told exists ─────────────────────────────────────── */

test("features follow capability, not type", () => {
  const chef = availableFeatures(["view:inventory", "manage:recipes"]);
  assert.ok(chef.includes("inventory"));
  assert.ok(chef.includes("recipes"));
  assert.ok(!chef.includes("profitability"), "a chef is not shown the margin as available");
  assert.ok(!chef.includes("purchasing"));
});

test("nothing unbuilt is ever listed as available", () => {
  /* §2: do not expose unfinished modules as working features. Orders, channel
     margin, shifts and modifiers are the bulk of the specification and none of
     them exist — a client that saw them here would draw a screen with nothing
     behind it. This assertion is what stops them being added to the response
     before they are added to the product. */
  const everything = availableFeatures(
    ["view:inventory", "manage:recipes", "view:costs", "manage:purchasing",
      "view:profitability", "view:forecast", "manage:staff", "view:dashboard"],
    { posConnected: true },
  );
  for (const unbuilt of ["orders", "channel_margin", "shifts", "modifiers", "tax", "payments"]) {
    assert.ok(!everything.includes(unbuilt), `${unbuilt} does not exist yet`);
  }
});

test("sales are only available where a till actually is", () => {
  const caps = ["view:dashboard"];
  assert.ok(!availableFeatures(caps, { posConnected: false }).includes("pos_sales"));
  assert.ok(availableFeatures(caps, { posConnected: true }).includes("pos_sales"));
});

test("the assistant is everybody's", () => {
  assert.ok(availableFeatures([]).includes("assistant"));
});

test("no capabilities is a short list, not a crash", () => {
  assert.deepEqual(availableFeatures(), ["assistant"]);
  assert.deepEqual(availableFeatures(null), ["assistant"]);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
