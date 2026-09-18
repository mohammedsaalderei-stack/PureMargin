/* The key in the clock-in link.

   This replaced a public directory that let anybody search every business
   using attendance and read its staff list, so the tests that matter are the
   ones about what a key will not do: resolve after it has been rotated,
   resolve for a business other than its own, or resolve at all when it is not
   a key.

   Rotation is the second half. It exists for the case of somebody leaving with
   the link on their phone, which means the old key has to stop working in the
   same breath — a link that keeps working for another hour has not been
   rotated — while the branches carry across, so the first person to use the
   new link is not met with an empty screen. */

import assert from "node:assert/strict";
import {
  clockKey, rotateClockKey, resolveClockKey, publishClockIn,
} from "./_clockkey.js";

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

const tick = () => new Promise((r) => setTimeout(r, 5));

await test("a business gets one key, and keeps it", async () => {
  const first = await clockKey("org-1");
  assert.match(first, /^[A-Za-z0-9_-]{32,}$/, "url-safe and long");

  /* Read back, not reissued. This is an address a manager has to be able to
     give to a new hire in June after setting it up in March — a key that
     changed on every read would break it for everyone already on the rota. */
  assert.equal(await clockKey("org-1"), first);
});

await test("two businesses never share a key", async () => {
  const a = await clockKey("org-2");
  const b = await clockKey("org-3");
  assert.notEqual(a, b);

  assert.equal((await resolveClockKey(a)).orgId, "org-2");
  assert.equal((await resolveClockKey(b)).orgId, "org-3");
});

await test("nothing that was not issued resolves", async () => {
  assert.equal(await resolveClockKey(""), null);
  assert.equal(await resolveClockKey(undefined), null);
  assert.equal(await resolveClockKey("short"), null);
  assert.equal(await resolveClockKey("x".repeat(200)), null);
  assert.equal(await resolveClockKey("../../etc/passwd"), null);
  assert.equal(await resolveClockKey("abcdefghijklmnop/q"), null);
  /* Well-formed and simply never issued, which is the case that matters:
     a key is twenty-four random bytes, and this is the assertion that says
     holding one is the only way in. */
  assert.equal(await resolveClockKey("A".repeat(32)), null);

  /* Deliberately not claimed here: that the shape regex in `_clockkey.js` is
     what refuses the malformed ones. It is not — the lookup refuses them
     anyway, and deleting the regex leaves every line above passing. The regex
     is there so junk traffic costs a match rather than a round trip, and the
     file says so. A test named for the guard would have read as coverage of a
     boundary it does not actually hold. */
});

await test("the branches come back with the key, in one read", async () => {
  const key = await clockKey("org-4");
  await publishClockIn("org-4", {
    name: "Al Manara Grill",
    branches: [{ id: "b1", name: "Jumeirah" }, { id: "b2", name: "Marina" }],
  });

  const place = await resolveClockKey(key);
  assert.equal(place.name, "Al Manara Grill");
  assert.equal(place.branches.length, 2);
  assert.equal(place.branches[1].name, "Marina");
});

await test("a key that has never been published still resolves", async () => {
  /* The very first person through the door can arrive before any manager has
     opened the staff screen. They should see a business with no branches, not
     a link that looks broken. */
  const key = await clockKey("org-5");
  const place = await resolveClockKey(key);
  assert.equal(place.orgId, "org-5");
  assert.deepEqual(place.branches, []);
  assert.equal(place.name, "");
});

await test("rotating kills the old link immediately", async () => {
  const before = await clockKey("org-6");
  await publishClockIn("org-6", { name: "Zaytoun", branches: [{ id: "b1", name: "Karama" }] });

  const after = await rotateClockKey("org-6");
  assert.notEqual(after, before);

  /* The whole point. A rotation happens because somebody walked out with the
     link, so the old one has to be dead now rather than soon. */
  assert.equal(await resolveClockKey(before), null);
  assert.equal((await resolveClockKey(after)).orgId, "org-6");
});

await test("rotating carries the branches over", async () => {
  await clockKey("org-7");
  await publishClockIn("org-7", {
    name: "Souk Cafe",
    branches: [{ id: "b1", name: "Deira" }, { id: "b2", name: "Satwa" }],
  });

  const after = await rotateClockKey("org-7");
  const place = await resolveClockKey(after);

  /* Otherwise the first person to use the new link gets an empty screen and
     has to wait for a manager to open the staff page before they can clock in. */
  assert.equal(place.name, "Souk Cafe");
  assert.deepEqual(place.branches.map((b) => b.name), ["Deira", "Satwa"]);
});

await test("rotating twice does not leave the middle key working", async () => {
  const one = await clockKey("org-8");
  const two = await rotateClockKey("org-8");
  const three = await rotateClockKey("org-8");

  assert.equal(await resolveClockKey(one), null);
  assert.equal(await resolveClockKey(two), null);
  assert.equal((await resolveClockKey(three)).orgId, "org-8");
});

await test("publishing the same thing writes nothing", async () => {
  const key = await clockKey("org-9");
  const same = { name: "Nakheel", branches: [{ id: "b1", name: "Main" }] };

  await publishClockIn("org-9", same);
  const first = (await resolveClockKey(key)) && (await publishClockIn("org-9", same));
  const stamp = first.at;

  await tick();
  await publishClockIn("org-9", same);
  assert.equal((await publishClockIn("org-9", same)).at, stamp, "unchanged means untouched");

  /* A branch renamed in the till does count, and is picked up by the ordinary
     act of somebody opening the staff screen. */
  await tick();
  await publishClockIn("org-9", { name: "Nakheel", branches: [{ id: "b1", name: "Karama" }] });
  const changed = await resolveClockKey(key);
  assert.equal(changed.branches[0].name, "Karama");
});

await test("a branch with no id is dropped rather than published as null", async () => {
  const key = await clockKey("org-10");
  await publishClockIn("org-10", {
    name: "Bab Al Bahr",
    branches: [{ id: "", name: "Ghost" }, { id: "b1", name: "Real" }],
  });

  const place = await resolveClockKey(key);
  assert.equal(place.branches.length, 1);
  assert.equal(place.branches[0].id, "b1");
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
