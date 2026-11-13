/* Printing, short of the wire: which printer gets what, what a job is made
   of, and what is remembered afterwards.

   The faults this guards were all real, and all silent:

     · a kitchen order was marked as sent whether or not it printed;
     · one count stood for every kitchen printer, so one printing hid
       another failing;
     · a printer with "print after every sale" off printed anyway, as long
       as some other printer had it on;
     · a second attempt printed a second copy;
     · a drawer command went to connections that cannot carry one;
     · a long receipt lost its end — the total;
     · a printer that could not be saved was shown as saved.

   The end-to-end half — the queue, the bridge, a printer on a socket — is
   `api/_print.test.js`. */

import assert from "node:assert/strict";
import { createJobManager, PrintError, shortHash } from "./PrintJobManager.js";
import { createPrinterService, PRINTERS_KEY } from "./PrinterService.js";
import { kitchenWork, applyKitchenResults, kitchenJobId, printerKey, sentTo } from "./kitchen.js";
import { job as escposJob, rasterCommands, rasterise, CUTS } from "./escpos.js";
import { PROFILES, profileOf } from "./profiles.js";

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log("  ok  ", name); }
  catch (err) { failures += 1; console.error("  FAIL", name, "\n       ", err.message); }
}

/* ── Stand-ins ── */

/* A drawing: `rows` rows of 16 dots, every one black. */
const image = (rows = 4) => {
  const data = new Uint8ClampedArray(16 * rows * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { width: 16, height: rows, data };
};
const sheet = (...rows) => ({ width: 16, parts: (rows.length ? rows : [4]).map((r) => ({ image: () => image(r), url: () => `data:image/png;base64,ROWS${r}` })) });

function memoryStorage({ broken = false, forgetful = false } = {}) {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { if (broken) throw new Error("QuotaExceededError"); if (!forgetful) map.set(k, String(v)); },
    map,
  };
}

/* An adapter that records what it was asked to send and does as it is told. */
function fakeAdapter({ raw = true, drawer = true, cut = true, behave = () => ({ state: "sent" }) } = {}) {
  const sent = [];
  return {
    id: raw ? "fake-raw" : "fake-picture",
    sent,
    capabilities: () => ({ raw, drawer, cut, silent: raw, reports: false }),
    async send(printer, payload) { sent.push({ printer, ...payload }); return behave(printer, payload, sent.length); },
  };
}

const printer = (over = {}) => ({ id: "p1", name: "Counter", role: "receipt", connection: "network", host: "192.168.8.19", port: 9100, paper: 80, autoPrint: true, drawer: true, cut: true, profile: "escpos", categories: [], ...over });
const has = (bytes, seq) => {
  outer: for (let i = 0; i <= bytes.length - seq.length; i += 1) {
    for (let j = 0; j < seq.length; j += 1) if (bytes[i + j] !== seq[j]) continue outer;
    return true;
  }
  return false;
};
const DRAWER = [0x1b, 0x70, 0x00, 0x19, 0xfa];

function service({ printers = [printer()], adapters = {}, storage = memoryStorage(), clock = { t: 1000 } } = {}) {
  storage.map.set(PRINTERS_KEY, JSON.stringify(printers));
  const raw = adapters.raw || fakeAdapter();
  const picture = adapters.picture || fakeAdapter({ raw: false, drawer: false, cut: false, behave: () => ({ state: "dialog" }) });
  const svc = createPrinterService({
    storage,
    adapterFor: (p) => (p.connection === "browser" || p.connection === "airprint" ? picture : raw),
    connections: () => ({ network: true, browser: true }),
    draw: { receipt: () => sheet(6), kitchen: (o) => sheet(o.lines.length), shift: () => sheet(3), test: () => sheet(2) },
    now: () => (clock.t += 1),
  });
  return { svc, raw, picture, storage };
}
const receipt = { receipt_number: "R-1001", total_money: 18 };

/* ── The job manager ── */

await test("a job that fails is reported as failed, with the reason — nothing is assumed to have printed", async () => {
  const adapter = fakeAdapter({ behave: () => { throw new PrintError("paperout"); } });
  const m = createJobManager({ adapterFor: () => adapter });
  const out = await m.submit({ id: "job-000001", kind: "receipt", printer: printer(), sheet: sheet() });
  assert.equal(out.ok, false);
  assert.equal(out.error, "paperout");
  assert.equal(m.statusOf("p1").state, "error");
  assert.equal(m.statusOf("p1").error, "paperout");
});

await test("an error that is not a print error is still a failure, never a success", async () => {
  const adapter = fakeAdapter({ behave: () => { throw new TypeError("boom"); } });
  const m = createJobManager({ adapterFor: () => adapter });
  const out = await m.submit({ id: "job-000002", kind: "receipt", printer: printer(), sheet: sheet() });
  assert.equal(out.ok, false);
  assert.equal(out.error, "failed");
});

await test("a job that printed is not sent again under the same id; one that failed is, marked as a retry", async () => {
  let fail = true;
  const adapter = fakeAdapter({ behave: () => { if (fail) throw new PrintError("unreachable"); return { state: "sent" }; } });
  const m = createJobManager({ adapterFor: () => adapter });
  const j = { id: "job-000003", kind: "kitchen", printer: printer(), sheet: sheet() };
  assert.equal((await m.submit(j)).ok, false);
  assert.equal(adapter.sent[0].retry, false, "the first attempt is not a retry");
  fail = false;
  assert.equal((await m.submit(j)).ok, true);
  assert.equal(adapter.sent[1].retry, true, "the second says so, so the queue lets it through");
  const third = await m.submit(j);
  assert.equal(third.ok, true);
  assert.equal(third.duplicate, true);
  assert.equal(adapter.sent.length, 2, "printed once: the third ask sent nothing");
});

await test("asking twice at the same moment sends once", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const adapter = fakeAdapter({ behave: async () => { await gate; return { state: "sent" }; } });
  const m = createJobManager({ adapterFor: () => adapter });
  const j = { id: "job-000004", kind: "receipt", printer: printer(), sheet: sheet() };
  const both = [m.submit(j), m.submit(j)];
  release();
  const [a, b] = await Promise.all(both);
  assert.equal(a.ok && b.ok, true);
  assert.equal(adapter.sent.length, 1);
});

await test("each printer's last outcome is its own", async () => {
  const adapter = fakeAdapter({ behave: (p) => { if (p.id === "cold") throw new PrintError("coveropen"); return { state: "printed", confirmed: true }; } });
  const m = createJobManager({ adapterFor: () => adapter });
  await m.submit({ id: "job-hot-01", kind: "kitchen", printer: printer({ id: "hot" }), sheet: sheet() });
  await m.submit({ id: "job-cold-1", kind: "kitchen", printer: printer({ id: "cold" }), sheet: sheet() });
  assert.equal(m.statusOf("hot").state, "ok");
  assert.equal(m.statusOf("hot").confirmed, true);
  assert.equal(m.statusOf("cold").state, "error");
  assert.equal(m.statusOf("cold").error, "coveropen");
});

await test("the drawer opens only where the job asked, the printer has one, and the connection can carry it", async () => {
  const send = async (adapter, p, drawer) => {
    const m = createJobManager({ adapterFor: () => adapter });
    await m.submit({ id: `job-${shortHash(JSON.stringify([p, drawer, adapter.id, adapter.capabilities().drawer]))}`, kind: "receipt", printer: p, sheet: sheet(), drawer });
    return adapter.sent[0];
  };
  assert.equal(has((await send(fakeAdapter(), printer(), true)).bytes, DRAWER), true, "asked, has one, can carry it");
  assert.equal(has((await send(fakeAdapter(), printer(), false)).bytes, DRAWER), false, "a card sale does not open it");
  assert.equal(has((await send(fakeAdapter(), printer({ drawer: false }), true)).bytes, DRAWER), false, "no drawer on this printer");
  assert.equal(has((await send(fakeAdapter({ drawer: false }), printer(), true)).bytes, DRAWER), false, "a connection that cannot carry it");
  const picture = await send(fakeAdapter({ raw: false, drawer: false, cut: false }), printer({ connection: "browser" }), true);
  assert.equal(picture.bytes, undefined, "a print dialog is sent a picture, never commands");
  assert.deepEqual(picture.pictures, ["data:image/png;base64,ROWS4"]);
});

await test("a drawer pulse on its own is refused by a connection that cannot open one", async () => {
  const m = createJobManager({ adapterFor: () => fakeAdapter({ raw: false, drawer: false, cut: false }) });
  const out = await m.submit({ id: "job-drawer1", kind: "drawer", printer: printer({ connection: "browser" }) });
  assert.equal(out.ok, false);
  assert.equal(out.error, "nodrawer");
});

await test("a printer with no cutter is fed, not cut; one with a cutter is cut unless switched off", async () => {
  const bytesFor = async (p) => {
    const adapter = fakeAdapter();
    await createJobManager({ adapterFor: () => adapter }).submit({ id: `job-cut-${shortHash(JSON.stringify(p))}`, kind: "receipt", printer: p, sheet: sheet() });
    return adapter.sent[0].bytes;
  };
  assert.equal(has(await bytesFor(printer()), CUTS.partial), true);
  assert.equal(has(await bytesFor(printer({ profile: "nocutter" })), CUTS.partial), false);
  assert.equal(has(await bytesFor(printer({ cut: false })), CUTS.partial), false);
  assert.equal(profileOf({ profile: "nonsense" }).id, "escpos", "an unknown model is treated as plain ESC/POS");
  assert.equal(PROFILES.every((p) => p.verified === false), true, "no model is called tested until one has been");
});

await test("copies are one transmission, and only the first opens the drawer", async () => {
  const adapter = fakeAdapter();
  await createJobManager({ adapterFor: () => adapter }).submit({ id: "job-copies", kind: "receipt", printer: printer({ copies: 2 }), sheet: sheet(), drawer: true });
  const { bytes } = adapter.sent[0];
  const count = (seq) => { let n = 0; for (let i = 0; i <= bytes.length - seq.length; i += 1) if (seq.every((b, j) => bytes[i + j] === b)) n += 1; return n; };
  assert.equal(adapter.sent.length, 1);
  assert.equal(count(CUTS.partial), 2);
  assert.equal(count(DRAWER), 1);
});

/* ── Long receipts ── */

await test("a long receipt reaches the printer whole: every row of every part, in order", async () => {
  /* Three parts, 300 + 500 + 41 rows; bands are 240 rows. */
  const parts = [image(300), image(500), image(41)];
  const bytes = escposJob(parts);
  let rows = 0;
  for (let i = 0; i < bytes.length - 8;) {
    if (bytes[i] === 0x1d && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x30) {
      const w = bytes[i + 4] | (bytes[i + 5] << 8);
      const h = bytes[i + 6] | (bytes[i + 7] << 8);
      assert.equal(h <= 240, true, "no band taller than a printer will take");
      rows += h;
      i += 8 + w * h;
    } else i += 1;
  }
  assert.equal(rows, 841);
  assert.equal(has(bytes.subarray(bytes.length - 8), CUTS.partial), true, "and the cut comes after the last of it");
  const one = rasterCommands(rasterise(image(241)));
  assert.equal(one.length, 241 * 2 + 16, "241 rows are two bands, nothing dropped between them");
});

await test("each band carries its own rows, not the first band's again", async () => {
  /* 500 rows of two bytes, each row holding its own number, so no row can
     stand in for another. (A repeating pattern would not do: the bands are
     240 rows, and anything that repeats every 2, 3 or 6 rows looks the same
     from row 240 as from row 0.) */
  const rows = 500;
  const bits = new Uint8Array(rows * 2);
  for (let y = 0; y < rows; y += 1) { bits[y * 2] = y & 0xff; bits[y * 2 + 1] = y >> 8; }
  const bytes = rasterCommands({ bits, bytesPerRow: 2, height: rows });
  const back = [];
  for (let i = 0; i < bytes.length;) {
    assert.deepEqual([...bytes.subarray(i, i + 4)], [0x1d, 0x76, 0x30, 0x00], "a band starts where the last one ended");
    const w = bytes[i + 4] | (bytes[i + 5] << 8), h = bytes[i + 6] | (bytes[i + 7] << 8);
    back.push(...bytes.subarray(i + 8, i + 8 + w * h));
    i += 8 + w * h;
  }
  assert.deepEqual(back, [...bits], "what the printer draws is the picture, row for row");
});

/* ── The service: which printers, and what is saved ── */

await test("the receipt after a sale goes only to printers set to print one; pressing Print goes to all", async () => {
  const { svc, raw } = service({ printers: [printer({ id: "a", name: "Counter" }), printer({ id: "b", name: "Bar", host: "192.168.8.20", autoPrint: false })] });
  const auto = await svc.printReceipt(receipt, {}, { auto: true });
  assert.deepEqual(auto.map((r) => r.id), ["a"], "the bar's printer is set not to");
  assert.equal(raw.sent.length, 1);
  const manual = await svc.printReceipt(receipt, {});
  assert.deepEqual(manual.map((r) => r.id).sort(), ["a", "b"]);
});

await test("the automatic receipt is one job however often it is asked for; a reprint is a new one each time", async () => {
  const { svc, raw } = service();
  await svc.printReceipt(receipt, {}, { auto: true });
  const again = await svc.printReceipt(receipt, {}, { auto: true });
  assert.equal(again[0].duplicate, true);
  assert.equal(raw.sent.length, 1, "the sale's receipt printed once");
  await svc.printReceipt(receipt, {});
  await svc.printReceipt(receipt, {});
  assert.equal(raw.sent.length, 3, "two presses of Print are two receipts");
});

await test("a printer that could not be saved is reported as not saved, and the list is what is really there", async () => {
  const full = service({ printers: [], storage: memoryStorage({ broken: true }) });
  full.storage.map.clear();
  const out = full.svc.savePrinters([printer()]);
  assert.equal(out.ok, false);
  assert.equal(out.error, "storage");
  assert.deepEqual(out.list, [], "not the list that was asked for");
  /* Storage that takes the write and keeps nothing: Safari in private mode. */
  const forgetful = service({ printers: [], storage: memoryStorage({ forgetful: true }) });
  forgetful.storage.map.clear();
  assert.equal(forgetful.svc.savePrinters([printer()]).ok, false);
  const fine = service({ printers: [] });
  const saved = fine.svc.savePrinters([printer({ name: "Counter" })]);
  assert.equal(saved.ok, true);
  assert.equal(fine.svc.loadPrinters()[0].name, "Counter", "and it is there when read back");
});

await test("a printer saved before there were models is plain ESC/POS with a cutter", async () => {
  const { svc } = service({ printers: [{ id: "old", role: "receipt", connection: "network", host: "10.0.0.5", port: 9100, paper: 80 }] });
  const [p] = svc.loadPrinters();
  assert.equal(p.profile, "escpos");
  assert.equal(p.cut, true);
});

await test("the settings screen is told what each printer can really do", async () => {
  const { svc } = service();
  assert.equal(svc.capabilitiesOf(printer()).drawer, true);
  assert.equal(svc.capabilitiesOf(printer({ connection: "browser" })).drawer, false, "a print dialog opens no drawer");
  assert.equal(svc.capabilitiesOf(printer({ connection: "browser" })).cut, false);
  assert.equal(svc.capabilitiesOf(printer({ profile: "nocutter" })).cut, false, "nor does a tear bar cut");
});

await test("a drawing that cannot be made is a failed print, not a crash", async () => {
  const storage = memoryStorage();
  storage.map.set(PRINTERS_KEY, JSON.stringify([printer()]));
  const adapter = fakeAdapter();
  const svc = createPrinterService({ storage, adapterFor: () => adapter, connections: () => ({ network: true }),
    draw: { receipt: () => { throw new Error("canvas too large"); } }, now: () => 5 });
  const [out] = await svc.printReceipt(receipt, {}, { auto: true });
  assert.equal(out.ok, false);
  assert.equal(out.error, "render");
  assert.equal(adapter.sent.length, 0);
});

await test("no drawer to open is said, not attempted", async () => {
  const { svc } = service({ printers: [printer({ connection: "browser" })] });
  await assert.rejects(() => svc.openDrawer(), (err) => err.code === "no-drawer");
  const ok = service();
  await ok.svc.openDrawer();
  assert.deepEqual([...ok.raw.sent[0].bytes], [0x1b, 0x40, ...DRAWER]);
});

/* ── The kitchen ── */

const hot = printer({ id: "hot", name: "Grill", role: "kitchen", host: "192.168.8.21", categories: ["Hot"] });
const cold = printer({ id: "cold", name: "Salads", role: "kitchen", host: "192.168.8.22", categories: ["Cold"] });
const pass = printer({ id: "pass", name: "Pass", role: "kitchen", host: "192.168.8.23" });
const lines = [
  { key: "a", qty: 2, name: "Burger", category: "Hot" },
  { key: "b", qty: 1, name: "Salad", category: "Cold" },
];
const round = (order, printers, results, opts) => {
  const work = kitchenWork(order, lines, printers, opts);
  return { work, ...applyKitchenResults(order, lines, printers, work, typeof results === "function" ? work.map(results) : results) };
};

await test("each kitchen printer is owed its own lines", async () => {
  const work = kitchenWork({}, lines, [hot, cold]);
  assert.deepEqual(work.map((w) => [w.printer.id, w.lines.map((l) => `${l.qty}×${l.name}`)]), [["hot", ["2×Burger"]], ["cold", ["1×Salad"]]]);
  assert.equal(work.every((w) => w.added === false), true);
});

await test("a line is marked as sent only on the printer that printed it", async () => {
  const first = round({}, [hot, cold], (w) => ({ ok: w.printer.id === "hot" }));
  assert.deepEqual(first.printedOn, { [printerKey(hot)]: { a: 2 } }, "the grill has its burgers");
  assert.deepEqual(first.printed, { a: 2 }, "the salad is not marked: its printer failed");
  /* Next time the order is saved, only the salad station is owed anything. */
  const work = kitchenWork(first, lines, [hot, cold]);
  assert.deepEqual(work.map((w) => w.printer.id), ["cold"]);
  assert.deepEqual(work[0].lines.map((l) => [l.key, l.qty]), [["b", 1]]);
});

await test("nothing printed means nothing marked — the fault this replaced", async () => {
  const out = round({}, [hot, cold], () => ({ ok: false, error: "unreachable" }));
  assert.deepEqual(out.printed, {});
  assert.deepEqual(out.printedOn, {});
});

await test("a line two printers both make is sent when both have it, and the one that failed is retried alone", async () => {
  const both = [pass, printer({ id: "pass2", name: "Expo", role: "kitchen", host: "192.168.8.24" })];
  const first = round({}, both, (w) => ({ ok: w.printer.id === "pass" }));
  assert.deepEqual(first.printed, {}, "not on every printer that makes it, so not sent");
  const work = kitchenWork(first, lines, both);
  assert.deepEqual(work.map((w) => w.printer.id), ["pass2"], "the pass is not printed twice");
  const second = applyKitchenResults(first, lines, both, work, [{ ok: true }]);
  assert.deepEqual(second.printed, { a: 2, b: 1 });
});

await test("adding to an order sends only what was added, and says it is an addition", async () => {
  const first = round({}, [hot, cold], () => ({ ok: true }));
  const more = [{ ...lines[0], qty: 3 }, lines[1]];
  const work = kitchenWork(first, more, [hot, cold]);
  assert.deepEqual(work.map((w) => [w.printer.id, w.added, w.lines.map((l) => [l.key, l.from, l.qty])]), [["hot", true, [["a", 2, 1]]]]);
});

await test("the same addition asked for twice is the same job; one more of the dish later is a new one", async () => {
  const [w1] = kitchenWork({}, lines, [hot]);
  const [w2] = kitchenWork({}, lines, [hot]);
  assert.equal(kitchenJobId(w1), kitchenJobId(w2), "a retry repeats the id, so it cannot print twice");
  const sent = applyKitchenResults({}, lines, [hot], [w1], [{ ok: true }]);
  /* Two more burgers after the first two: the same line, the same quantity
     owed — and a different job, because of what had been sent before. */
  const [w3] = kitchenWork(sent, [{ ...lines[0], qty: 4 }], [hot]);
  assert.deepEqual([w3.lines[0].from, w3.lines[0].qty], [2, 2]);
  assert.notEqual(kitchenJobId(w3), kitchenJobId(w1), "two more burgers are not a retry of the first two");
  assert.notEqual(kitchenJobId(w1, { again: "x1" }), kitchenJobId(w1), "printing again by choice is a new job");
  assert.match(kitchenJobId(w1), /^[A-Za-z0-9][A-Za-z0-9:_.-]{5,79}$/, "and it is an id the queue accepts");
});

await test("a kitchen printer with auto-print off is left alone until somebody asks", async () => {
  const manual = { ...cold, autoPrint: false };
  const auto = round({}, [hot, manual], () => ({ ok: true }));
  assert.deepEqual(auto.work.map((w) => w.printer.id), ["hot"]);
  assert.deepEqual(auto.printed, { a: 2 }, "and it does not hold the others' lines back");
  assert.deepEqual(kitchenWork(auto, lines, [hot, manual], { manual: true }).map((w) => w.printer.id), ["cold"]);
  /* Even when it makes the very same lines as a printer that did print. */
  const spare = { ...pass, id: "spare", host: "192.168.8.25", autoPrint: false };
  const shared = round({}, [pass, spare], () => ({ ok: true }));
  assert.deepEqual(shared.work.map((w) => w.printer.id), ["pass"]);
  assert.deepEqual(shared.printed, { a: 2, b: 1 }, "sent, though the spare printer never had them");
});

await test("a reprint sends every line in full and changes no record", async () => {
  const done = round({}, [hot, cold], () => ({ ok: true }));
  const work = kitchenWork(done, lines, [hot, cold], { manual: true, whole: true });
  assert.deepEqual(work.map((w) => w.lines.map((l) => l.qty)), [[2], [1]]);
  assert.equal(work.every((w) => w.added === false), true);
});

await test("a ticket from a till that kept one count is read as sent, not printed all over again", async () => {
  const old = { printed: { a: 2, b: 1 } };
  assert.deepEqual(kitchenWork(old, lines, [hot, cold]), []);
  assert.equal(sentTo(old, printerKey(hot), "a"), 2);
  assert.equal(sentTo({ printed: { a: 2 }, printedOn: { [printerKey(hot)]: { a: 1 } } }, printerKey(hot), "a"), 1, "this printer's own count wins");
});

await test("the same network printer is one printer from any till; a USB one is this till's", async () => {
  assert.equal(printerKey(printer({ id: "x", host: "192.168.8.19" })), printerKey(printer({ id: "y", host: "192.168.8.19 " })));
  assert.notEqual(printerKey(printer({ host: "192.168.8.19", port: 9100 })), printerKey(printer({ host: "192.168.8.19", port: 9101 })));
  assert.equal(printerKey(printer({ id: "u1", connection: "usb" })), "dev:u1");
});

await test("the service sends each kitchen printer its own job and answers in the same order", async () => {
  const adapter = fakeAdapter({ behave: (p) => { if (p.id === "cold") throw new PrintError("paperout"); return { state: "sent" }; } });
  const { svc } = service({ printers: [hot, cold], adapters: { raw: adapter } });
  const work = kitchenWork({}, lines, [hot, cold]);
  const results = await svc.printKitchen({ name: "T4" }, {}, work);
  assert.deepEqual(results.map((r) => [r.id, r.ok, r.error || null]), [["hot", true, null], ["cold", false, "paperout"]]);
  assert.equal(new Set(adapter.sent.map((s) => s.id)).size, 2, "two printers, two jobs");
  /* Retried: the grill is not asked again. */
  const next = applyKitchenResults({}, lines, [hot, cold], work, results);
  const again = await svc.printKitchen({ name: "T4" }, {}, kitchenWork(next, lines, [hot, cold]));
  assert.deepEqual(again.map((r) => r.id), ["cold"]);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
