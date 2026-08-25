/* The team board.

   What these protect: targeting narrows rather than hides; an owner counts as
   part of any branch; an empty audience means everyone; only important
   messages notify; nobody is mailed their own message; the unread badge counts
   only what is addressed to the reader; and the board can't grow without
   limit. */

import assert from "node:assert/strict";
import { backend, __resetMemory } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

const m = await import("./_messages.js");

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

const ORG = "org-1";
const org = () => ({
  id: ORG,
  name: "Sufra Group",
  ownerUsername: "owner",
  members: {
    owner: { role: "owner", branches: [] },
    ops: { role: "ops", branches: ["b1", "b2"] },
    alain: { role: "branch_manager", branches: ["b1"] },
    dubai: { role: "branch_manager", branches: ["b2"] },
    chef: { role: "chef", branches: ["b1"] },
    book: { role: "accountant", branches: [] },
  },
});

const A = (branches = [], roles = []) => m.normaliseAudience({ branches, roles });

await test("an empty audience is everyone", () => {
  const a = A();
  assert.equal(m.audienceIsEveryone(a), true);
  for (const member of Object.values(org().members)) {
    assert.equal(m.matchesAudience(a, member), true);
  }
});

await test("a branch audience reaches that branch and not the other", () => {
  const a = A(["b1"]);
  const o = org();
  assert.equal(m.matchesAudience(a, o.members.alain), true);
  assert.equal(m.matchesAudience(a, o.members.dubai), false);
});

await test("the owner is inside every branch audience", () => {
  const o = org();
  assert.equal(m.matchesAudience(A(["b2"]), o.members.owner), true,
    "an announcement to a branch still concerns the person who owns it");
});

await test("a role audience reaches that role only", () => {
  const o = org();
  const a = A([], ["chef"]);
  assert.equal(m.matchesAudience(a, o.members.chef), true);
  assert.equal(m.matchesAudience(a, o.members.alain), false);
});

await test("branch and role narrow together, not apart", () => {
  const o = org();
  const a = A(["b1"], ["branch_manager"]);
  assert.equal(m.matchesAudience(a, o.members.alain), true, "right branch, right role");
  assert.equal(m.matchesAudience(a, o.members.dubai), false, "right role, wrong branch");
  assert.equal(m.matchesAudience(a, o.members.chef), false, "right branch, wrong role");
});

await test("an unknown role is dropped rather than trusted", () => {
  const a = A([], ["chef", "wizard"]);
  assert.deepEqual(a.roles, ["chef"]);
});

await test("a member with no branches is outside a branch audience", () => {
  const o = org();
  assert.equal(m.matchesAudience(A(["b1"]), o.members.book), false);
});

await test("an empty body is refused", async () => {
  const { error } = await m.postMessage(ORG, { author: "owner", body: "   " });
  assert.equal(error, "empty");
});

await test("an over-long body is refused", async () => {
  const { error } = await m.postMessage(ORG, { author: "owner", body: "x".repeat(m.MAX_BODY + 1) });
  assert.equal(error, "long");
});

await test("a posted message comes back on the board", async () => {
  await m.postMessage(ORG, { author: "owner", body: "Stock count Friday" });
  const list = await m.listMessages(ORG);
  assert.equal(list.length, 1);
  assert.equal(list[0].body, "Stock count Friday");
  assert.equal(list[0].important, false);
});

await test("only important messages notify", () => {
  const o = org();
  const plain = { author: "owner", important: false, audience: A() };
  assert.deepEqual(m.recipientsFor(o, plain), []);
  const flagged = { author: "owner", important: true, audience: A() };
  assert.ok(m.recipientsFor(o, flagged).length > 0);
});

await test("the author is never mailed their own message", () => {
  const o = org();
  const names = m.recipientsFor(o, { author: "owner", important: true, audience: A() })
    .map((r) => r.username);
  assert.ok(!names.includes("owner"));
  assert.equal(names.length, Object.keys(o.members).length - 1);
});

await test("an important message to one branch mails only that branch and the owner", () => {
  const o = org();
  const names = m.recipientsFor(o, { author: "ops", important: true, audience: A(["b1"]) })
    .map((r) => r.username).sort();
  assert.deepEqual(names, ["alain", "chef", "owner"]);
});

await test("an important message to one role mails only that role", () => {
  const o = org();
  const names = m.recipientsFor(o, { author: "owner", important: true, audience: A([], ["chef"]) })
    .map((r) => r.username);
  assert.deepEqual(names, ["chef"]);
});

await test("unread counts only what is addressed to the reader", async () => {
  const o = org();
  await m.postMessage(ORG, { author: "owner", body: "for chefs", audience: A([], ["chef"]) });
  await m.postMessage(ORG, { author: "owner", body: "for everyone" });
  assert.equal(await m.unreadCount(o, "chef"), 2, "chef is in both");
  assert.equal(await m.unreadCount(o, "book"), 1, "accountant only sees the open one");
});

await test("your own messages do not show as unread", async () => {
  const o = org();
  await m.postMessage(ORG, { author: "owner", body: "mine" });
  assert.equal(await m.unreadCount(o, "owner"), 0);
});

await test("marking read clears the count", async () => {
  const o = org();
  await m.postMessage(ORG, { author: "owner", body: "one" });
  assert.equal(await m.unreadCount(o, "chef"), 1);
  await m.markRead(ORG, "chef");
  assert.equal(await m.unreadCount(o, "chef"), 0);
});

await test("a message posted after a read still counts", async () => {
  const o = org();
  await m.markRead(ORG, "chef", Date.now() - 1000);
  await m.postMessage(ORG, { author: "owner", body: "later" });
  assert.equal(await m.unreadCount(o, "chef"), 1);
});

await test("someone with no membership sees no unread", async () => {
  const o = org();
  await m.postMessage(ORG, { author: "owner", body: "one" });
  assert.equal(await m.unreadCount(o, "stranger"), 0);
});

await test("the board does not grow past its ceiling", async () => {
  for (let i = 0; i < m.MAX_MESSAGES + 10; i += 1) {
    await m.postMessage(ORG, { author: "owner", body: `note ${i}` });
  }
  const list = await m.listMessages(ORG);
  assert.equal(list.length, m.MAX_MESSAGES);
  assert.equal(list.at(-1).body, `note ${m.MAX_MESSAGES + 9}`, "the newest must survive");
  assert.equal(list[0].body, "note 10", "the oldest fall off the front");
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
