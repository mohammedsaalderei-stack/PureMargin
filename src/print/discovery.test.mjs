/* "Find printers" in the app: what the two searches are joined into, and
   what picking one puts in the form.

   The fault this exists for was real: the search only listened for printers
   that announce themselves, the shop's printer announces nothing, and the
   app said "None found" with the printer answering at 192.168.8.19. The
   sweep itself is Swift (`PrinterPlugin.scan`) and is checked on a device;
   everything decided in JavaScript is checked here. */

import assert from "node:assert/strict";
import { mergeFound, ipv4Number, foundKey, isChosen, chooseFound } from "./discovery.js";
import { createNativePrintAdapter } from "./adapters/NativePrintAdapter.js";

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log("  ok  ", name); }
  catch (err) { failures += 1; console.error("  FAIL", name, "\n       ", err.message); }
}

const named = [{ name: "TM-m30III", service: "TM-m30III" }];
const swept = (...hosts) => hosts.map((host) => ({ host, port: 9100 }));

await test("a printer found by address is listed by its address, after the ones that announced a name", () => {
  const out = mergeFound(named, swept("192.168.8.19"));
  assert.deepEqual(out, [
    { name: "TM-m30III", service: "TM-m30III" },
    { name: "192.168.8.19", host: "192.168.8.19", port: 9100 },
  ]);
});

await test("addresses are in address order, not alphabetical", () => {
  const out = mergeFound([], swept("192.168.8.100", "192.168.8.19", "192.168.8.2"));
  assert.deepEqual(out.map((f) => f.host), ["192.168.8.2", "192.168.8.19", "192.168.8.100"], "a string sort puts .100 before .19");
});

await test("each address once, each announced printer once", () => {
  const out = mergeFound([...named, ...named], [...swept("192.168.8.19", "192.168.8.19 "), { host: "192.168.8.19" }]);
  assert.equal(out.filter((f) => f.service).length, 1, "the same service twice is one printer");
  assert.equal(out.filter((f) => f.host).length, 1, "the same address three ways is one printer");
});

await test("a printer on another port says so, and is a different printer from the same address on 9100", () => {
  const out = mergeFound([], [{ host: "192.168.8.30", port: 9101 }, { host: "192.168.8.30", port: 9100 }]);
  assert.deepEqual(out.map((f) => f.name), ["192.168.8.30", "192.168.8.30:9101"]);
  assert.deepEqual(out.map((f) => f.port), [9100, 9101]);
});

await test("anything that is not an address or not a service is left out", () => {
  const out = mergeFound(
    [{ name: "no service" }, null, { service: "" }],
    [{ host: "" }, { host: "printer.local" }, { host: "192.168.8.256" }, { host: "192.168.8" }, { host: "1.2.3.4.5" }, {}, null, { host: 42 }],
  );
  assert.deepEqual(out, []);
});

await test("a search that came back with nothing usable is an empty list, not a crash", () => {
  assert.deepEqual(mergeFound(undefined, undefined), []);
  assert.deepEqual(mergeFound(null, "nonsense"), []);
  assert.deepEqual(mergeFound({}, { host: "192.168.8.19" }), [], "an object where a list belongs");
});

await test("an announced printer without a name is shown under its service", () => {
  assert.deepEqual(mergeFound([{ service: "Kitchen" }], []), [{ name: "Kitchen", service: "Kitchen" }]);
});

await test("an address is read as a number only when it is one", () => {
  assert.equal(ipv4Number("192.168.8.19"), ((192 * 256 + 168) * 256 + 8) * 256 + 19);
  assert.equal(ipv4Number(" 10.0.0.1 "), 10 * 256 ** 3 + 1);
  for (const bad of ["", "1.2.3", "1.2.3.4.5", "1.2.3.256", "a.b.c.d", "1.2.3.-4", "1..3.4", null, 5]) {
    assert.equal(ipv4Number(bad), null, `${JSON.stringify(bad)} is not an address`);
  }
});

await test("picking a printer found by address fills in its address and port, and leaves the name to the owner", () => {
  const form = { name: "", service: "TM-m30III", host: "", port: 9100 };
  const patch = chooseFound(form, { name: "192.168.8.19", host: "192.168.8.19", port: 9100 });
  assert.deepEqual(patch, { service: "", host: "192.168.8.19", port: 9100 }, "the service is cleared, or the app would still send there");
  assert.equal("name" in patch, false, "an address is not a name");
});

await test("picking an announced printer takes its name only when the printer has none", () => {
  assert.deepEqual(chooseFound({ name: "" }, named[0]), { service: "TM-m30III", host: "", name: "TM-m30III" });
  assert.equal(chooseFound({ name: "Bar" }, named[0]).name, "Bar");
});

await test("the tick sits on the printer the form holds, and on one printer only", () => {
  const byAddress = { name: "192.168.8.19", host: "192.168.8.19", port: 9100 };
  assert.equal(isChosen({ host: "192.168.8.19", port: 9100, service: "" }, byAddress), true);
  assert.equal(isChosen({ host: "192.168.8.19 ", port: "9100" }, byAddress), true, "as the form holds it: typed, with a stray space");
  assert.equal(isChosen({ host: "192.168.8.19" }, byAddress), true, "a form with no port prints to 9100, so it is this one");
  assert.equal(isChosen({ host: "192.168.8.19", port: 9101 }, byAddress), false, "another port is another printer");
  assert.equal(isChosen({ host: "192.168.8.20", port: 9100 }, byAddress), false);
  assert.equal(isChosen({ host: "192.168.8.19", port: 9100, service: "TM-m30III" }, byAddress), false, "the form sends to the service, not the address");
  assert.equal(isChosen({ service: "TM-m30III" }, named[0]), true);
  assert.equal(isChosen({ service: "", host: "TM-m30III" }, named[0]), false);
});

await test("a printer found both ways is listed under two different keys", () => {
  assert.notEqual(foundKey({ service: "192.168.8.19:9100" }), foundKey({ host: "192.168.8.19", port: 9100 }));
});

/* ── The app's search, with a stand-in for the Swift plugin ── */

function plugin({ discover = async () => ({ printers: named }), scan = async () => ({ printers: swept("192.168.8.19") }) } = {}) {
  const calls = [];
  return {
    calls,
    discover: (o) => { calls.push(["discover", o]); return discover(o); },
    scan: (o) => { calls.push(["scan", o]); return scan(o); },
  };
}

await test("the app looks both ways at once and lists both", async () => {
  let release;
  const slow = new Promise((r) => { release = r; });
  const fake = plugin({ discover: () => slow.then(() => ({ printers: named })) });
  const pending = createNativePrintAdapter({ plugin: fake }).discover();
  await Promise.resolve();
  assert.deepEqual(fake.calls.map(([name]) => name), ["discover", "scan"], "the sweep does not wait for the announcements");
  assert.deepEqual(fake.calls.find(([name]) => name === "scan")[1].ports, [9100]);
  release();
  assert.deepEqual((await pending).map((f) => f.name), ["TM-m30III", "192.168.8.19"]);
});

await test("one search failing leaves the other's printers", async () => {
  const noBonjour = plugin({ discover: async () => { throw new Error("PolicyDenied"); } });
  assert.deepEqual((await createNativePrintAdapter({ plugin: noBonjour }).discover()).map((f) => f.host), ["192.168.8.19"]);
  const noSweep = plugin({ scan: () => { throw new Error("not implemented"); } });
  assert.deepEqual((await createNativePrintAdapter({ plugin: noSweep }).discover()).map((f) => f.service), ["TM-m30III"]);
  const neither = plugin({ discover: async () => null, scan: async () => ({}) });
  assert.deepEqual(await createNativePrintAdapter({ plugin: neither }).discover(), []);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
