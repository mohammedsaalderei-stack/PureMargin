/* Photographs, the limits on an endpoint with no session, and who gets told.

   Three things here are worth a test rather than a comment.

   A photograph can be deleted and the punch it belongs to cannot. Somebody's
   hours come out of the punch; the picture is evidence attached to it. If
   removing one ever took the other with it, a business would lose a shift by
   tidying up a photo.

   The rate limits are the only thing standing between a public write and
   anybody who finds it. A limit that does not actually stop the four hundred
   and first punch is decoration.

   And the notice goes to the people who can act on it, which is the same set
   the roster is gated on — not to everybody in the organization. */

import assert from "node:assert/strict";
import {
  photoProblem, savePhoto, readPhoto, readThumbs, readThumbsFor, removePhoto,
  dayKeyFor, noteAndCheckRate, recentRepeat, punchMail, notifyManagers,
  PUNCH_LIMIT_PER_DAY, REPEAT_WINDOW_MS, MAX_PHOTO_CHARS, MAX_THUMB_CHARS,
} from "./_attendance.js";
import { createAccount } from "./_accounts.js";

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

const jpeg = (n = 40) => `data:image/jpeg;base64,${"A".repeat(n)}`;

/* ── What may be stored ─────────────────────────────────────────────────── */

await test("a photograph has to look like one", () => {
  assert.equal(photoProblem(jpeg()), null);
  assert.equal(photoProblem(`data:image/png;base64,${"A".repeat(20)}`), null);
  assert.equal(photoProblem(`data:image/webp;base64,${"A".repeat(20)}`), null);

  assert.equal(photoProblem(""), "missing");
  assert.equal(photoProblem(undefined), "missing");
  assert.equal(photoProblem("https://example.com/a.jpg"), "shape");
  assert.equal(photoProblem("data:text/html;base64,PHNjcmlwdD4="), "shape");

  /* An SVG is a document that can carry script, and it is left out of the
     allowed list on purpose. A raster type cannot do anything when the owner's
     browser renders it; this one could. */
  assert.equal(photoProblem("data:image/svg+xml;base64,PHN2Zz4="), "shape");
});

await test("an absurd photograph is refused rather than stored", () => {
  assert.equal(photoProblem(jpeg(MAX_PHOTO_CHARS + 10)), "toobig");
  /* The thumbnail is held to its own, much smaller, ceiling — a day's worth of
     them are read together, so one oversized thumbnail is felt on every row. */
  assert.equal(photoProblem(jpeg(MAX_THUMB_CHARS + 10), { max: MAX_THUMB_CHARS }), "toobig");
  assert.equal(photoProblem(jpeg(100), { max: MAX_THUMB_CHARS }), null);
});

/* ── Storing and removing ───────────────────────────────────────────────── */

await test("both sizes come back, and the thumbnails of a day come back together", async () => {
  const at = Date.UTC(2026, 1, 3, 8, 0, 0);
  await savePhoto("o1", "p1", { full: jpeg(100), thumb: jpeg(10), at });
  await savePhoto("o1", "p2", { full: jpeg(120), thumb: jpeg(12), at: at + 60000 });

  assert.equal((await readPhoto("o1", "p1")).url, jpeg(100));

  const day = await readThumbs("o1", dayKeyFor(at));
  assert.deepEqual(Object.keys(day).sort(), ["p1", "p2"]);
});

await test("removing a photograph removes both copies", async () => {
  const at = Date.UTC(2026, 1, 4, 8, 0, 0);
  await savePhoto("o2", "p9", { full: jpeg(100), thumb: jpeg(10), at });

  await removePhoto("o2", "p9");

  assert.equal(await readPhoto("o2", "p9"), null, "the full one is gone");
  assert.equal((await readThumbs("o2", dayKeyFor(at))).p9, undefined, "and so is the thumbnail");
});

await test("removing one photograph leaves the others alone", async () => {
  const at = Date.UTC(2026, 1, 5, 8, 0, 0);
  await savePhoto("o3", "keep", { full: jpeg(100), thumb: jpeg(10), at });
  await savePhoto("o3", "drop", { full: jpeg(100), thumb: jpeg(10), at });

  await removePhoto("o3", "drop");

  assert.ok(await readPhoto("o3", "keep"));
  assert.ok((await readThumbs("o3", dayKeyFor(at))).keep);
});

await test("a day with no photographs is an empty map, not a crash", async () => {
  assert.deepEqual(await readThumbs("o-none", "2026-01-01"), {});
  assert.deepEqual(await readThumbsFor("o-none", []), {});
  assert.equal(await readPhoto("o-none", "nothing"), null);
});

await test("thumbnails are gathered across days without repeating a read", async () => {
  const one = Date.UTC(2026, 2, 1, 9, 0, 0);
  const two = Date.UTC(2026, 2, 2, 9, 0, 0);
  await savePhoto("o4", "a", { full: jpeg(50), thumb: jpeg(8), at: one });
  await savePhoto("o4", "b", { full: jpeg(50), thumb: jpeg(8), at: two });

  const all = await readThumbsFor("o4", [dayKeyFor(one), dayKeyFor(two), dayKeyFor(one)]);
  assert.deepEqual(Object.keys(all).sort(), ["a", "b"]);
});

/* ── The limits on a public write ───────────────────────────────────────── */

await test("a day fills up, and the next day starts empty", async () => {
  const at = Date.UTC(2026, 3, 1, 10, 0, 0);
  for (let i = 0; i < PUNCH_LIMIT_PER_DAY; i += 1) {
    const out = await noteAndCheckRate("o5", at);
    assert.equal(out.ok, true, `punch ${i + 1} should be allowed`);
  }
  assert.equal((await noteAndCheckRate("o5", at)).ok, false, "and the next one is not");

  const tomorrow = at + 24 * 60 * 60 * 1000;
  assert.equal((await noteAndCheckRate("o5", tomorrow)).ok, true);
});

await test("one business filling its day does not stop another", async () => {
  const at = Date.UTC(2026, 3, 2, 10, 0, 0);
  for (let i = 0; i < PUNCH_LIMIT_PER_DAY; i += 1) await noteAndCheckRate("o6", at);
  assert.equal((await noteAndCheckRate("o6", at)).ok, false);
  assert.equal((await noteAndCheckRate("o7", at)).ok, true);
});

await test("two taps moments apart are one arrival", () => {
  const now = 1_000_000;
  const punches = [
    { id: "p1", employeeId: "e1", kind: "in", at: now - 5000 },
    { id: "p2", employeeId: "e2", kind: "in", at: now - 1000 },
  ];

  assert.equal(recentRepeat(punches, "e1", now).id, "p1");
  assert.equal(recentRepeat(punches, "e2", now).id, "p2");

  /* Long enough ago and it is a real departure, which is the case that must
     not be swallowed: somebody who clocks in and leaves after two minutes has
     worked two minutes, and the ledger should say so. */
  assert.equal(recentRepeat(punches, "e1", now + REPEAT_WINDOW_MS), null);
  assert.equal(recentRepeat(punches, "e3", now), null);
  assert.equal(recentRepeat([], "e1", now), null);
});

/* ── The notice ─────────────────────────────────────────────────────────── */

await test("the mail carries the name, the time and both languages", () => {
  const mail = punchMail({
    name: "Aisha Rahman",
    title: "Head chef",
    kind: "in",
    at: Date.UTC(2026, 4, 6, 3, 12, 0),
    branchName: "Marina",
    business: "Al Manara Grill",
    link: "https://puremargin.ae/#/app/employees",
  });

  assert.match(mail.subject, /Aisha Rahman clocked in/);
  assert.match(mail.text, /Al Manara Grill/);
  assert.match(mail.text, /Marina/);
  /* 03:12 UTC is 07:12 in the Gulf, and a manager reading "03:12" would think
     somebody opened four hours early. */
  assert.match(mail.text, /07:12/);
  assert.match(mail.text, /سجّل الحضور/, "and it reads in Arabic too");
  assert.match(mail.html, /dir="rtl"/, "with the Arabic half set right to left");

  const out = punchMail({ name: "Aisha Rahman", kind: "out", at: Date.now(), business: "X" });
  assert.match(out.subject, /clocked out/);
});

await test("the notice goes to the people who could act on it", async () => {
  await createAccount({ username: "owner1", password: "goodpass1", email: "owner@example.com" });
  await createAccount({ username: "mgr1", password: "goodpass1", email: "mgr@example.com" });
  await createAccount({ username: "chef1", password: "goodpass1", email: "chef@example.com" });
  await createAccount({ username: "acct1", password: "goodpass1", email: "acct@example.com" });

  const org = {
    id: "org-mail",
    members: {
      owner1: { role: "owner" },
      mgr1: { role: "branch_manager" },
      /* A chef runs the kitchen and is the tempting one to include. They do
         not keep the rota — `manage:staff` says who does — and a bell that
         carries somebody else's business is a bell they stop reading. */
      chef1: { role: "chef" },
      acct1: { role: "accountant" },
    },
  };

  const quiet = console.log;
  console.log = () => {};
  try {
    const sent = await notifyManagers(org, punchMail({ name: "A", kind: "in", at: Date.now() }));
    assert.equal(sent.considered, 2, "the owner and the branch manager, nobody else");
    assert.equal(sent.sent, 2);
  } finally {
    console.log = quiet;
  }
});

await test("an account with no address is skipped, not counted as sent", async () => {
  await createAccount({ username: "silent1", password: "goodpass1" });
  const org = { id: "org-silent", members: { silent1: { role: "owner" } } };

  const quiet = console.log;
  console.log = () => {};
  try {
    const out = await notifyManagers(org, punchMail({ name: "A", kind: "in", at: Date.now() }));
    /* "If there is an email" is the normal case, not an edge one: an account
       here is a username and a password, and an address is something somebody
       adds later. */
    assert.equal(out.considered, 1);
    assert.equal(out.sent, 0);
  } finally {
    console.log = quiet;
  }
});

await test("switching the mail off stops it", async () => {
  const org = {
    id: "org-off",
    staffMail: false,
    members: { owner1: { role: "owner" } },
  };
  const out = await notifyManagers(org, punchMail({ name: "A", kind: "in", at: Date.now() }));
  assert.equal(out.sent, 0);
  assert.equal(out.reason, "off");
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
