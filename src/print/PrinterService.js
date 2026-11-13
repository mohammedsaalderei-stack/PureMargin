/* PrinterService: the printers this device prints to, and what the register
   asks of them.

   Printers belong to the device, not the business: the iPad at the counter
   prints to the receipt printer beside it, the one at the pass to the
   kitchen. So the list lives in this device's storage, never on the server.

   Three layers, each ignorant of the next:

     this file            which printers exist, which of them a receipt or an
                          order goes to, and what is drawn for each
     PrintJobManager.js   one job format; builds the bytes; remembers what
                          each printer last did; never prints one id twice
     adapters/            how bytes or a picture actually leave the device —
                          the only part that differs between Safari, Chrome
                          and the app

   ── How a job gets to a printer ──────────────────────────────────────────

   network   A receipt printer on the shop's network, at an IP address and a
             port (9100 on nearly all of them). In the app the connection is
             opened directly. On the website a browser may not open one, so
             the job goes through the print bridge — a small program on a
             computer in the shop — and comes out with no print dialog.
   airprint  The iPhone's or iPad's own printing. A picture, and a dialog.
   usb       A printer plugged into a computer, from Chrome or Edge (WebUSB).
   serial    The same over a serial or USB-serial port (Web Serial).
   bluetooth In the app: Bluetooth LE printers found by scanning, and Epson
             or Star printers paired in iPhone Settings (MFi). On the website:
             Chrome or Edge, LE printers only; Safari has no Bluetooth.
   browser   The browser's own print dialog — always there, and the answer
             for any printer the computer already has installed.

   A cash drawer plugs into the receipt printer, so it can be opened only
   over a connection that carries commands: network, usb, serial, bluetooth.
   A picture sent to a print dialog cannot open a drawer, and is never asked
   to. */

import { dotsFor } from "./escpos.js";
import { createJobManager, PrintError, shortHash } from "./PrintJobManager.js";
import { profileOf, DEFAULT_PROFILE } from "./profiles.js";
import { printerKey, kitchenJobId } from "./kitchen.js";

export const PRINTERS_KEY = "pm_printers";
const STATUS_KEY = "pm_printer_status";

/* A canvas, as the job manager wants a drawing: something that can give its
   dots or its picture when asked, and not before. */
const asPart = (c) => (typeof c.image === "function" ? c : {
  image: () => c.getContext("2d").getImageData(0, 0, c.width, c.height),
  url: () => c.toDataURL("image/png"),
});
const asSheet = (sheet) => ({ ...sheet, parts: sheet.parts.map(asPart) });
const safe = (s) => String(s ?? "").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 40) || "x";

export function createPrinterService({ storage, adapterFor, connections, draw, now = () => Date.now() }) {
  const store = () => (typeof storage === "function" ? storage() : storage);
  const read = (key, fallback) => {
    try { const v = store().getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  };

  const manager = createJobManager({
    adapterFor, now,
    onChange: (all) => { try { store().setItem(STATUS_KEY, JSON.stringify(all)); } catch { /* status is a convenience */ } },
  });
  manager.restore(read(STATUS_KEY, {}));

  /* ── The list ── */

  function loadPrinters() {
    const list = read(PRINTERS_KEY, []);
    if (!Array.isArray(list)) return [];
    /* Printers saved before there were profiles are plain ESC/POS with a cutter. */
    return list.map((p) => ({ profile: DEFAULT_PROFILE, cut: true, ...p }));
  }

  /* Save the list, and say whether it was saved.

     This used to swallow the failure. Storage does fail — private browsing,
     a full disk, a browser set to forget — and then the screen said "saved",
     the printer was there until the page reloaded, and the next morning
     nothing printed and nobody knew why. So the write is checked by reading
     it back, and a list that did not stick is reported as not saved. */
  function savePrinters(list) {
    const raw = JSON.stringify(list);
    try {
      store().setItem(PRINTERS_KEY, raw);
      if (store().getItem(PRINTERS_KEY) !== raw) throw new Error("not kept");
    } catch {
      return { ok: false, error: "storage", list: loadPrinters() };
    }
    return { ok: true, list };
  }

  function newPrinter(over = {}) {
    const avail = connections();
    return {
      id: `pr${now().toString(36)}`,
      name: "",
      connection: avail.network ? "network" : "browser",
      profile: DEFAULT_PROFILE,
      host: "",
      port: 9100,
      paper: 80,
      role: "receipt",
      categories: [],
      autoPrint: true,
      drawer: true,
      cut: true,
      copies: 1,
      ...over,
    };
  }

  /* What this printer, on this connection, on this device, can do. The
     settings screen shows a switch only for what is true here. */
  function capabilitiesOf(printer) {
    const adapter = adapterFor(printer);
    const caps = adapter ? adapter.capabilities(printer) : { raw: false, drawer: false, cut: false, silent: false, reports: false };
    const profile = profileOf(printer);
    return {
      via: adapter?.id || "",
      raw: caps.raw,
      drawer: Boolean(caps.drawer && profile.drawer),
      cut: Boolean(caps.cut && profile.cut),
      silent: caps.silent,
      reports: Boolean(caps.reports && profile.status),
      canProbe: typeof adapter?.probe === "function",
      needsRegistering: typeof adapter?.register === "function",
    };
  }

  const widthOf = (printer) => dotsFor(printer.paper);
  const outcome = (printer, r) => ({ id: printer.id, name: printer.name || "", key: printerKey(printer), ...r });
  const failed = (printer, code, detail = "") => outcome(printer, { ok: false, state: "failed", error: code, detail, uncertain: false });

  async function send(printer, kind, id, makeSheet, extra = {}) {
    let sheet = null;
    if (makeSheet) {
      try { sheet = asSheet(makeSheet()); } catch (err) { return failed(printer, "render", String(err?.message || err)); }
    }
    return outcome(printer, await manager.submit({ id, kind, printer, sheet, ...extra }));
  }

  /* ── What the register asks for ── */

  /* A receipt, to the receipt printers. `auto` is the print that follows a
     sale by itself: only printers set to print after every sale take it, and
     its job id is the receipt's own, so being asked twice prints once.
     Without `auto` somebody pressed Print, and every receipt printer does. */
  async function printReceipt(receipt, ctx, { openDrawer = false, copy = false, auto = false } = {}) {
    const printers = loadPrinters().filter((p) => p.role === "receipt" && (!auto || p.autoPrint !== false));
    return Promise.all(printers.map((printer) => send(
      printer, "receipt",
      `r-${safe(receipt.receipt_number)}-${shortHash(printerKey(printer))}${copy ? "-c" : ""}${auto ? "" : `-m${now().toString(36)}`}`,
      () => draw.receipt(receipt, { ...ctx, copy, width: widthOf(printer) }),
      { drawer: openDrawer },
    )));
  }

  /* An order to the kitchen: one job per printer, each with the lines that
     printer owes (`kitchenWork`). Answers in the same order as `work`.
     `again[key]` makes that printer's job a new one — somebody looked at an
     uncertain print and chose to print it again. */
  async function printKitchen(order, ctx, work, { whole = false, again = {} } = {}) {
    return Promise.all(work.map((w) => send(
      w.printer, "kitchen",
      kitchenJobId(w, { whole: whole ? now().toString(36) : "", again: again[w.key] || "" }),
      () => draw.kitchen({ ...order, lines: w.lines }, { ...ctx, added: w.added, width: widthOf(w.printer) }),
    )));
  }

  /* The kitchen job id for a piece of work, for marking it done by hand. */
  const settleKitchen = (w) => manager.settle({ id: kitchenJobId(w), kind: "kitchen", printer: w.printer });

  async function printShift(shift, summary, ctx) {
    const printer = loadPrinters().find((p) => p.role === "receipt");
    if (!printer) return [{ ok: false, error: "no-printer" }];
    return [await send(printer, "shift", `s-${now().toString(36)}-${shortHash(printer.id)}`,
      () => draw.shift(shift, summary, { ...ctx, width: widthOf(printer) }))];
  }

  async function testPrint(printer, ctx) {
    return send(printer, "test", `t-${now().toString(36)}-${shortHash(printer.id)}`,
      () => draw.test(printer, { ...ctx, width: widthOf(printer) }));
  }

  /* The drawer on its own — "no sale". Only through a printer that has one
     and a connection that can carry the command. */
  async function openDrawer() {
    const printer = loadPrinters().find((p) => p.role === "receipt" && p.drawer !== false && capabilitiesOf(p).drawer);
    if (!printer) throw new PrintError("no-drawer");
    const out = await send(printer, "drawer", `d-${now().toString(36)}-${shortHash(printer.id)}`, null);
    if (!out.ok) throw new PrintError(out.error, out.detail);
    return out;
  }

  /* Make a printer usable before anything is sent to it. For a network
     printer on the website that means telling the print queue its address —
     which needs settings rights, and says so if they are missing. */
  async function prepare(printer) {
    const adapter = adapterFor(printer);
    if (typeof adapter?.register !== "function") return { ok: true };
    try { await adapter.register(printer); return { ok: true }; }
    catch (err) { return { ok: false, error: err instanceof PrintError ? err.code : "failed" }; }
  }

  /* Is the printer there? Prints nothing. */
  async function checkPrinter(printer) {
    const adapter = adapterFor(printer);
    if (typeof adapter?.probe !== "function") return { ok: false, error: "noprobe" };
    try {
      const out = await adapter.probe(printer);
      return { ok: true, printer: out.printer || null, ms: out.ms ?? null };
    } catch (err) {
      return { ok: false, error: err instanceof PrintError ? err.code : "failed", detail: err?.detail || "" };
    }
  }

  return {
    loadPrinters, savePrinters, newPrinter, capabilitiesOf, prepare, checkPrinter,
    printReceipt, printKitchen, settleKitchen, printShift, testPrint, openDrawer,
    statusOf: manager.statusOf, subscribe: manager.subscribe,
  };
}
