/* Printing to a network printer from a browser, end to end.

   Every piece here is the real one: the till's adapter
   (`src/print/adapters/LanBridgeAdapter.js`), the route (`api/print.js`) and
   its queue, the bridge program a shop would run
   (`public/bridge/print-bridge.mjs`), and a TCP socket at the far end. The
   only stand-in is the printer (`scripts/fake-printer.mjs`), which speaks
   ESC/POS and keeps what it was sent — because the tests must not need
   hardware, and because the thing being tested is precisely the difference
   between "the job was accepted" and "it came out".

   What this protects:

     · a job that is accepted and never printed is a failure, with a reason
       a person can act on — printer off, paper out, cover open, bridge not
       running, connection dropped part-way;
     · a retry never prints a second copy of something that printed;
     · a job handed to a bridge that went quiet is neither printed nor
       failed-and-retried: it is unconfirmed, and stays so;
     · a job goes only where somebody with settings rights said it may, and
       the bridge will not write outside a private network whoever asks;
     · a bridge's token is that bridge's, for that business, until removed.

   It does not prove that paper comes out of an iCE IRP-200D. Nothing that
   runs on a laptop can. */

import assert from "node:assert/strict";
import { backend, __resetMemory, listKeys, getJSON, setJSON } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

const { createAccount, getAccount } = await import("./_accounts.js");
const { issueToken, issueDeviceToken } = await import("./_auth.js");
const { orgFor } = await import("./_org.js");
const { readAudit } = await import("./_audit.js");
const queue = await import("./_printqueue.js");
const route = (await import("./print.js")).default;
const bridge = await import("../public/bridge/print-bridge.mjs");
const { fakePrinter, inkOf, toPng } = await import("../scripts/fake-printer.mjs");
const { createLanBridgeAdapter } = await import("../src/print/adapters/LanBridgeAdapter.js");
const { PrintError } = await import("../src/print/PrintJobManager.js");
const { job: escposJob } = await import("../src/print/escpos.js");
const { POS_STRINGS } = await import("../src/i18n-pos.js");

function fakeRes() {
  const r = { code: null, body: null, headers: {}, setHeader(k, v) { r.headers[k] = v; return r; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } };
  return r;
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/* The wire to the server, for the till and for the bridge. A real pause on
   each request: without one, a till polling an in-memory store would never
   let the bridge's socket have a turn. */
let wire = "up";
async function wireFetch(url, init = {}) {
  await pause(3);
  if (wire === "down") throw new TypeError("Failed to fetch");
  const u = new URL(url, "http://till.test");
  const res = fakeRes();
  const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  await route({ method: init.method || "GET", url: u.pathname + u.search, headers, query: Object.fromEntries(u.searchParams), body: init.body ? JSON.parse(init.body) : undefined }, res);
  return { ok: res.code >= 200 && res.code < 300, status: res.code, json: async () => res.body };
}
const api = async (token, method, what, { query = {}, body } = {}) => {
  const res = await wireFetch(`/api/print?${new URLSearchParams({ what, ...query })}`, { method, headers: { Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};

let failures = 0;
const open = [];
async function test(name, fn) {
  __resetMemory();
  wire = "up";
  try { await fn(); console.log("  ok  ", name); }
  catch (err) { failures += 1; console.error("  FAIL", name, "\n       ", err.message); }
  for (const p of open.splice(0)) await p.close();
}

/* A business, its owner signed in, one bridge that has said hello, and a
   printer on a socket registered as somewhere jobs may go. */
async function shop({ mode = "ok", register = true, hello = true, user = "owner1", ...printerOpts } = {}) {
  await createAccount({ username: user, password: "Print-test-9x!" });
  const account = await getAccount(user);
  const org = await orgFor(account);
  const token = issueToken(user, account.tokenVersion || 0);
  const printer = await fakePrinter({ mode, ...printerOpts });
  open.push(printer);
  const made = await api(token, "POST", "bridge", { body: { name: "Back office" } });
  assert.equal(made.status, 200);
  const target = { host: "localhost", port: printer.port };
  if (register) assert.equal((await api(token, "PUT", "target", { body: target })).status, 200);
  const memory = bridge.createMemory();
  const logs = [];
  /* One pass of the bridge: collect what is queued, print it, report. */
  const work = (over = {}) => bridge.runBridge({
    server: "http://localhost", token: made.body.token, memory, fetchImpl: wireFetch, wait: 0, rounds: 1,
    allow: ["localhost"], log: (s) => logs.push(s), ...over,
  });
  if (hello) await work();
  const till = createLanBridgeAdapter({ auth: () => ({ token }), fetchImpl: wireFetch, wait: 0 });
  return { org, token, account, printer, bridgeToken: made.body.token, bridgeId: made.body.bridge.id, target, work, memory, logs, till, user };
}

/* A receipt's worth of dots: 576 across, a black band in the middle. */
function receiptBytes({ rows = 120, drawer = false } = {}) {
  const width = 576;
  const data = new Uint8ClampedArray(width * rows * 4).fill(255);
  for (let y = 20; y < 60; y += 1) for (let x = 100; x < 400; x += 1) { const i = (y * width + x) * 4; data[i] = data[i + 1] = data[i + 2] = 0; }
  return escposJob({ width, height: rows, data }, { drawer });
}
const INK = 40 * 300;

/* The till sends a job and the bridge does its rounds until the till has its answer. */
async function print(s, id, { bytes = receiptBytes(), retry = false, passes = 3, over = {} } = {}) {
  const sending = s.till.send(s.target, { id, kind: "receipt", bytes, retry }).then((ok) => ({ ok }), (err) => ({ err }));
  for (let i = 0; i < passes; i += 1) { await pause(15); await s.work(over); }
  return sending;
}

/* ── It prints ── */

await test("a receipt sent from the till comes out of the printer, byte for byte, and is confirmed by the printer", async () => {
  const s = await shop();
  const bytes = receiptBytes({ drawer: true });
  const out = await print(s, "r-R1001-abc", { bytes });
  assert.equal(out.err, undefined, out.err?.code);
  assert.equal(out.ok.state, "printed");
  assert.equal(out.ok.confirmed, true, "the printer said it had paper and a closed cover, before and after");
  const [job] = s.printer.printed();
  assert.equal(s.printer.printed().length, 1);
  assert.equal(job.rows.length, 120, "every row");
  assert.equal(job.bytesPerRow, 72);
  assert.equal(inkOf(job), INK, "the same dots the till drew");
  assert.equal(job.cut, 1);
  assert.equal(job.drawer, 1);
  assert.equal(job.complete, true);
  assert.equal(toPng(job).subarray(1, 4).toString("latin1"), "PNG", "and it can be looked at");
  assert.equal((await listKeys(`print:${s.org.id}:data:`)).length, 0, "the bytes are not kept once printed");
});

await test("a printer that does not answer status questions is 'sent', never 'confirmed'", async () => {
  const s = await shop({ mode: "silent" });
  const out = await print(s, "r-R1002-abc");
  assert.equal(out.ok.state, "sent");
  assert.equal(out.ok.confirmed, false, "bytes left; nobody but a person at the printer knows more");
  assert.equal(s.printer.printed().length, 1);
});

await test("the connection test reaches the printer, prints nothing, and reports paper and cover", async () => {
  const s = await shop();
  const probing = s.till.probe(s.target);
  await pause(15); await s.work(); await s.work();
  const out = await probing;
  assert.equal(out.reachable, true);
  assert.equal(out.printer.answered, true);
  assert.equal(out.printer.paper, "ok");
  assert.equal(out.printer.cover, "closed");
  assert.equal(out.printer.model, "FAKE-80");
  assert.equal(s.printer.printed().length, 0);
});

/* ── It does not print, and says why ── */

await test("out of paper: the job fails with that reason and nothing is sent to the printer", async () => {
  const s = await shop({ mode: "paperout" });
  const out = await print(s, "k-hot-0001");
  assert.equal(out.err instanceof PrintError, true);
  assert.equal(out.err.code, "paperout");
  assert.equal(out.err.printer.paper, "out");
  assert.equal(s.printer.printed().length, 0, "not half a ticket");
});

await test("cover open: the same, by its own name", async () => {
  const s = await shop({ mode: "coveropen" });
  assert.equal((await print(s, "k-hot-0002")).err.code, "coveropen");
  assert.equal(s.printer.printed().length, 0);
});

await test("paper runs out during the print: failed, even though every byte was accepted", async () => {
  const s = await shop({ runsOutAfter: 100 });
  const out = await print(s, "k-hot-0003");
  assert.equal(out.err.code, "paperout", "accepted is not printed");
});

await test("printer switched off: the job fails as unreachable or refused, not silently", async () => {
  const s = await shop();
  await s.printer.close();
  const out = await print(s, "k-hot-0004");
  assert.equal(["refused", "unreachable"].includes(out.err.code), true, out.err.code);
});

await test("the connection drops part-way: failed as interrupted", async () => {
  const s = await shop({ mode: "silent", dropAfter: 2000 });
  const out = await print(s, "k-hot-0005");
  assert.equal(out.err.code, "interrupted");
});

await test("a printer that hangs up politely part-way is a failure too, though nothing errored", async () => {
  const s = await shop({ mode: "silent", endAfter: 2000 });
  const out = await print(s, "k-hot-0006");
  assert.equal(out.err?.code, "interrupted", "closing its side without an error is still not a printed ticket");
});

await test("a printer that answers goodbye with a reset, having taken everything, has still printed", async () => {
  const s = await shop({ mode: "silent", resetOnClose: true });
  const out = await print(s, "k-hot-0007");
  assert.equal(out.err, undefined, `not a failure: asking for it again would print a second ticket (${out.err?.code})`);
  assert.equal(out.ok.state, "sent", "sent, not confirmed: this printer answers no questions");
  assert.equal(s.printer.printed().length, 1);
});

await test("no bridge, a bridge that is not running, a printer nobody registered: each refused at once, by name", async () => {
  await createAccount({ username: "owner1", password: "Print-test-9x!" });
  const account = await getAccount("owner1");
  const token = issueToken("owner1", account.tokenVersion || 0);
  const till = createLanBridgeAdapter({ auth: () => ({ token }), fetchImpl: wireFetch, wait: 0 });
  const send = (port = 9100) => till.send({ host: "192.168.8.19", port }, { id: `r-${port}-x1`, kind: "receipt", bytes: receiptBytes() }).then(() => null, (e) => e.code);
  assert.equal(await send(), "notarget", "nothing is set up at all");
  assert.equal((await api(token, "PUT", "target", { body: { host: "192.168.8.19", port: 9100 } })).body.error, "nobridge");
  await api(token, "POST", "bridge", { body: { name: "PC" } });
  await api(token, "PUT", "target", { body: { host: "192.168.8.19", port: 9100 } });
  assert.equal(await send(), "bridgeoffline", "the bridge has never been run");
  assert.equal(await send(9101), "notarget", "a port nobody registered");
});

await test("the till with no internet says so rather than waiting", async () => {
  const s = await shop();
  wire = "down";
  const err = await s.till.send(s.target, { id: "r-off-0001", kind: "receipt", bytes: receiptBytes() }).then(() => null, (e) => e);
  assert.equal(err.code, "nonetwork");
});

/* ── Retries and duplicates ── */

await test("a retry of a job that printed prints nothing more", async () => {
  const s = await shop();
  assert.equal((await print(s, "k-dup-0001")).ok.state, "printed");
  const again = await print(s, "k-dup-0001", { retry: true });
  assert.equal(again.ok.state, "printed", "told what became of the first");
  assert.equal(s.printer.printed().length, 1, "one ticket in the kitchen");
});

await test("a retry of a job that failed prints it once", async () => {
  const s = await shop({ mode: "paperout" });
  assert.equal((await print(s, "k-retry-001")).err.code, "paperout");
  s.printer.set({ mode: "ok" });
  const plain = await print(s, "k-retry-001");
  assert.equal(plain.err.code, "paperout", "asking again without saying it is a retry reports the old outcome");
  const out = await print(s, "k-retry-001", { retry: true });
  assert.equal(out.ok.state, "printed");
  assert.equal(s.printer.printed().length, 1);
  assert.equal((await queue.getJob(s.org.id, "k-retry-001")).attempts, 2);
});

await test("a job the bridge took and never answered for is unconfirmed — not printed, not failed-and-queued-again", async () => {
  const s = await shop();
  const t0 = Date.now();
  const q = await queue.enqueue(s.org.id, { id: "k-lost-0001", ...s.target, data: Buffer.from(receiptBytes()).toString("base64") }, { now: t0 });
  assert.equal(q.queued, true);
  const taken = await queue.claim(s.org.id, s.bridgeId, { now: t0 + 1000 });
  assert.equal(taken.length, 1);
  /* The bridge's computer goes to sleep here. */
  const later = t0 + 1000 + queue.LEASE_MS + 1;
  const job = await queue.getJob(s.org.id, "k-lost-0001", later);
  assert.equal(job.state, "failed");
  assert.equal(job.error, "unconfirmed");
  assert.deepEqual(await queue.claim(s.org.id, s.bridgeId, { now: later }), [], "it is not handed out a second time");
  const again = await queue.enqueue(s.org.id, { id: "k-lost-0001", ...s.target, data: "AAAA", retry: true }, { now: later });
  assert.equal(again.duplicate, true, "and a retry under the same id does not queue it");
  assert.equal(again.job.error, "unconfirmed");
  /* The bridge wakes up and says what actually happened. */
  await queue.report(s.org.id, s.bridgeId, { id: "k-lost-0001", ok: true, wrote: 100, printer: { answered: true } }, { now: later + 5000 });
  assert.equal((await queue.getJob(s.org.id, "k-lost-0001", later + 6000)).state, "printed", "the fact replaces the guess");
});

await test("a job nobody collected in time is failed, and does not print when the bridge comes back", async () => {
  const s = await shop();
  const t0 = Date.now();
  await queue.enqueue(s.org.id, { id: "k-late-0001", ...s.target, data: Buffer.from(receiptBytes()).toString("base64") }, { now: t0 });
  const late = t0 + queue.JOB_TTL + 1;
  assert.deepEqual(await queue.claim(s.org.id, s.bridgeId, { now: late }), []);
  const job = await queue.getJob(s.org.id, "k-late-0001", late);
  assert.equal(job.error, "expired");
  assert.equal((await listKeys(`print:${s.org.id}:data:`)).length, 0);
});

await test("the bridge remembers what it printed: handed the same job twice, it prints once and says so", async () => {
  const s = await shop();
  assert.equal((await print(s, "k-twice-001")).ok.state, "printed");
  /* The server loses the outcome and hands the job out again. */
  const key = `print:${s.org.id}:job:k-twice-001`;
  await setJSON(key, { ...(await getJSON(key)), state: "queued", createdAt: Date.now() });
  await setJSON(`print:${s.org.id}:data:k-twice-001`, { z: (await import("zlib")).deflateSync(Buffer.from(receiptBytes())).toString("base64") });
  await setJSON(`print:${s.org.id}:wake`, { at: Date.now() });
  await s.work();
  assert.equal(s.printer.printed().length, 1, "not a second ticket");
  assert.equal((await queue.getJob(s.org.id, "k-twice-001")).state, "printed");
  assert.equal(s.logs.some((l) => /already printed/.test(l)), true);
});

await test("an outcome the server did not hear is told again, not lost and not reprinted", async () => {
  const s = await shop();
  await queue.enqueue(s.org.id, { id: "k-unsent-01", ...s.target, data: Buffer.from(receiptBytes()).toString("base64") });
  /* The bridge prints, and the report fails on its way back. */
  let calls = 0;
  await s.work({ fetchImpl: async (url, init) => { calls += 1; if (/what=done/.test(url)) throw new TypeError("Failed to fetch"); return wireFetch(url, init); } });
  assert.equal(calls > 0, true);
  assert.equal(s.printer.printed().length, 1);
  assert.equal((await queue.getJob(s.org.id, "k-unsent-01")).state, "sending", "the server still thinks it is out being printed");
  await s.work();
  assert.equal((await queue.getJob(s.org.id, "k-unsent-01")).state, "printed");
  assert.equal(s.printer.printed().length, 1);
});

/* ── Who may send what where ── */

await test("the bridge will not write outside a private network, whoever asks", async () => {
  const s = await shop();
  const out = await print(s, "k-allow-001", { over: { allow: [] } });
  assert.equal(out.err.code, "notallowed");
  assert.equal(s.printer.printed().length, 0);
  const direct = await bridge.sendToPrinter({ host: "8.8.8.8", port: 9100, data: Buffer.from("x") });
  assert.equal(direct.error, "notallowed");
});

await test("the server and the bridge agree on what a private address is", async () => {
  const table = { "10.0.0.5": true, "172.16.0.1": true, "172.31.255.254": true, "172.32.0.1": false, "192.168.8.19": true, "169.254.1.1": true,
    "127.0.0.1": false, "8.8.8.8": false, "192.169.1.1": false, "256.1.1.1": false, "printer": false, "": false };
  for (const [host, want] of Object.entries(table)) {
    assert.equal(queue.isPrivateIPv4(host), want, `server: ${host}`);
    assert.equal(bridge.isPrivateIPv4(host), want, `bridge: ${host}`);
  }
  assert.equal(queue.readTarget({ host: "8.8.8.8", port: 9100 }).error, "host");
  assert.equal(queue.readTarget({ host: "example.com", port: 9100 }).error, "host", "a name on the internet is not a printer");
  assert.equal(queue.readTarget({ host: "tm-m30.local", port: 9100 }).host, "tm-m30.local");
  assert.equal(queue.readTarget({ host: "192.168.8.19", port: 0 }).error, "port");
});

await test("a staff device can print and can use a registered printer, but cannot register one or make a bridge", async () => {
  const s = await shop();
  const device = issueDeviceToken(s.user, s.account.tokenVersion || 0);
  assert.equal((await api(device, "GET", "setup")).status, 200, "the print route is open to a register-only device");
  assert.equal((await api(device, "GET", "setup")).body.canManage, false);
  assert.equal((await api(device, "PUT", "target", { body: s.target })).status, 200, "already registered: nothing to permit");
  assert.equal((await api(device, "PUT", "target", { body: { host: "192.168.8.1", port: 80 } })).status, 403, "the router's admin page is not a printer");
  assert.equal((await api(device, "POST", "bridge", { body: { name: "x" } })).status, 403);
  assert.equal((await api(device, "DELETE", "bridge", { query: { id: s.bridgeId } })).status, 403);
  const till = createLanBridgeAdapter({ auth: () => ({ token: device }), fetchImpl: wireFetch, wait: 0 });
  const sending = till.send(s.target, { id: "r-dev-0001", kind: "receipt", bytes: receiptBytes() });
  await pause(15); await s.work(); await s.work();
  assert.equal((await sending).state, "printed");
});

await test("a bridge's token is that bridge's: not a session, not another business's, and dead once the bridge is removed", async () => {
  const s = await shop();
  assert.equal((await api(s.bridgeToken, "GET", "hello")).body.bridge.name, "Back office");
  assert.equal((await api(s.bridgeToken, "GET", "setup")).status, 400, "it cannot read the settings");
  assert.equal((await api(s.token, "GET", "claim")).status, 400, "and a session cannot collect jobs");
  assert.equal((await api(`${s.bridgeToken.slice(0, -2)}xx`, "GET", "hello")).status, 401);
  /* Another business, with a job waiting. */
  const other = await shop({ user: "owner2" });
  await queue.enqueue(other.org.id, { id: "k-other-001", ...other.target, data: Buffer.from(receiptBytes()).toString("base64") });
  assert.deepEqual((await api(s.bridgeToken, "GET", "claim")).body.jobs, [], "not its job to take");
  assert.equal((await api(s.token, "GET", "job", { query: { id: "k-other-001" } })).status, 404, "nor its owner's to see");
  assert.equal((await api(s.token, "DELETE", "bridge", { query: { id: s.bridgeId } })).status, 200);
  assert.equal((await api(s.bridgeToken, "GET", "hello")).status, 401, "removed");
  assert.deepEqual((await api(s.token, "GET", "setup")).body.targets, [], "and the printers it reached go with it");
  const audit = (await readAudit(s.org.id)).map((e) => e.action);
  for (const action of ["print.bridge.add", "print.target.add", "print.bridge.remove"]) assert.equal(audit.includes(action), true, action);
});

await test("with two bridges, a job goes to the one that reaches its printer and the other leaves it alone", async () => {
  const s = await shop();
  const second = await api(s.token, "POST", "bridge", { body: { name: "Second site" } });
  await api(second.body.token, "GET", "hello");
  await queue.enqueue(s.org.id, { id: "k-site-0001", ...s.target, data: Buffer.from(receiptBytes()).toString("base64") });
  assert.deepEqual((await api(second.body.token, "GET", "claim")).body.jobs, [], "the other site's bridge cannot reach that printer");
  assert.equal((await api(second.body.token, "POST", "done", { body: { id: "k-site-0001", ok: true } })).status, 403, "nor answer for it");
  assert.equal((await api(s.bridgeToken, "GET", "claim")).body.jobs.length, 1);
});

await test("a ticket keeps what each printer printed, and a late retry cannot bring back a ticket that was paid", async () => {
  const s = await shop();
  const { saveTicket, getTicket, deleteTicket, markTicketPrinted } = await import("./_tillbook.js");
  const { ticket } = await saveTicket(s.org.id, {
    lines: [{ key: "a", itemId: "recipe:wrap", qty: 2 }], printed: { a: 2 },
    printedOn: { "net:192.168.8.21:9100": { a: 2 }, "net:192.168.8.22:9100": { a: "junk", b: 5000 } },
  }, { branchId: "register" });
  assert.deepEqual(ticket.printedOn, { "net:192.168.8.21:9100": { a: 2 }, "net:192.168.8.22:9100": { a: 0, b: 999 } }, "kept per printer, and bounded");
  const marked = await markTicketPrinted(s.org.id, ticket.id, { printed: { a: 2 }, printedOn: { "net:192.168.8.22:9100": { a: 2 } } });
  assert.deepEqual(marked.ticket.printedOn, { "net:192.168.8.22:9100": { a: 2 } });
  assert.equal(marked.ticket.lines.length, 1, "nothing else about the ticket moves");
  await deleteTicket(s.org.id, ticket.id);
  assert.equal((await markTicketPrinted(s.org.id, ticket.id, { printed: { a: 2 } })).error, "ticket");
  assert.equal(await getTicket(s.org.id, ticket.id), null, "paid stays paid");
});

await test("a bridge told not to hold requests open spaces its questions out instead of hammering the server", async () => {
  const s = await shop();
  let asked = 0;
  const counting = (url, init) => { if (String(url).includes("what=claim")) asked += 1; return wireFetch(url, init); };
  const started = Date.now();
  await s.work({ rounds: 3, idle: 60, fetchImpl: counting });
  assert.equal(asked, 3);
  assert.equal(Date.now() - started >= 110, true, "two gaps between three questions with nothing to do");
});

await test("the bridge's token never travels in the clear to a server on the internet", async () => {
  assert.throws(() => bridge.checkServer("http://example.com"), /https/);
  assert.equal(bridge.checkServer("https://example.com/app"), "https://example.com");
  assert.equal(bridge.checkServer("http://localhost:3001"), "http://localhost:3001", "a development server on this machine is fine");
});

await test("a job is only ever its bytes: too big, empty or malformed is refused, and nothing is queued", async () => {
  const s = await shop();
  const post = (body) => api(s.token, "POST", "job", { body: { ...s.target, ...body } });
  assert.equal((await post({ id: "ok-000001" })).body.error, "data");
  assert.equal((await post({ id: "x", data: "AAAA" })).body.error, "id");
  assert.equal((await post({ id: "ok/../../x", data: "AAAA" })).body.error, "id");
  assert.equal((await post({ id: "ok-000002", data: "A".repeat(queue.MAX_BYTES * 1.4 + 8) })).body.error, "data");
  /* Short enough as text to pass the first look, too long once decoded. */
  const justOver = Buffer.alloc(queue.MAX_BYTES + 1).toString("base64");
  assert.equal(justOver.length < queue.MAX_BYTES * 1.4, true);
  assert.equal((await post({ id: "ok-000003", data: justOver })).body.error, "data");
  assert.equal((await post({ id: "ok-000004", data: "====" })).body.error, "data", "text that decodes to nothing is not a job");
  assert.equal((await listKeys(`print:${s.org.id}:job:`)).length, 0);
});

/* ── The words ── */

await test("every reason a print can fail has a sentence, in every language", async () => {
  const codes = ["unreachable", "refused", "timeout", "interrupted", "paperout", "coveropen", "offline", "printererror",
    "nobridge", "bridgeoffline", "notarget", "expired", "unconfirmed", "nonetwork", "notallowed", "notfound", "signin", "forbidden"];
  for (const lang of Object.keys(POS_STRINGS)) {
    for (const code of codes) assert.equal(typeof POS_STRINGS[lang].print.reasons[code], "string", `${lang}: ${code}`);
  }
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
