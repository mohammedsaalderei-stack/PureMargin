#!/usr/bin/env node
/* PureMargin print bridge.

   A web page cannot open a connection to a receipt printer. This program can.
   It runs on any computer that stays on inside the shop — the same network as
   the printers — and does one thing: asks PureMargin, over HTTPS, whether
   there is anything to print, and writes what it is given to the printer.

       till (Safari) → PureMargin → this program → printer

   It only ever calls out. It opens no port, so nothing on the internet can
   reach it or the printers, and it needs no change to the router.

   Needs Node 18 or newer and nothing else. No packages to install.

     node print-bridge.mjs --server https://your-site --token B.xxxxx
         Run. The address and token are remembered, so next time it is just:
     node print-bridge.mjs

     node print-bridge.mjs --probe 192.168.8.19
         Ask a printer what it answers on. Needs no account. Run this first
         with a new printer: it says which port takes print data and whether
         the printer reports its paper and cover.
     node print-bridge.mjs --test 192.168.8.19:9100
         Print a few lines of text straight from this computer.

   What it will not do: write to an address that is not on a private network,
   unless that address is named with --allow. A job is somebody else's bytes,
   and "print this" must not become "send this anywhere". */

import net from "node:net";
import dns from "node:dns/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const VERSION = "1.0.0";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── Where a job may be written ─────────────────────────────────────────── */

export function isPrivateIPv4(host) {
  const m = String(host).match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((n) => n > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

export class PrintFailure extends Error {
  constructor(code, detail = "", extra = {}) {
    super(detail || code);
    this.code = code;
    this.detail = detail;
    Object.assign(this, extra);
  }
}

/* A name is looked up; what it comes out as is what is checked. */
async function resolveTarget(host, allow = []) {
  const name = String(host || "").trim().toLowerCase();
  if (!name) throw new PrintFailure("notfound", "no address");
  let address = name;
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(name)) {
    try { address = (await dns.lookup(name, { family: 4 })).address; }
    catch { throw new PrintFailure("notfound", `no printer called ${name} on this network`); }
  }
  if (!isPrivateIPv4(address) && !allow.includes(address) && !allow.includes(name)) {
    throw new PrintFailure("notallowed", `${address} is not an address on a private network`);
  }
  return address;
}

const CODE_OF = {
  ECONNREFUSED: "refused", EHOSTUNREACH: "unreachable", ENETUNREACH: "unreachable", EHOSTDOWN: "unreachable",
  ETIMEDOUT: "unreachable", EADDRNOTAVAIL: "unreachable", ENOTFOUND: "notfound",
};

function connect(address, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: address, port });
    const timer = setTimeout(() => { socket.destroy(); reject(new PrintFailure("unreachable", `no answer from ${address}:${port}`)); }, timeoutMs);
    socket.once("connect", () => { clearTimeout(timer); socket.setNoDelay(true); resolve(socket); });
    socket.once("error", (err) => { clearTimeout(timer); reject(new PrintFailure(CODE_OF[err.code] || "unreachable", err.message)); });
  });
}

/* ── What the printer says about itself ─────────────────────────────────── */

/* Everything the printer sends back lands here; a question takes what
   arrives after it was asked and nothing from before. */
function listen(socket) {
  let waiting = null;
  let failed = null;
  socket.on("data", (chunk) => { if (waiting) { const w = waiting; waiting = null; w(chunk); } });
  socket.on("error", (err) => { failed = err; if (waiting) { const w = waiting; waiting = null; w(null); } });
  return {
    get failed() { return failed; },
    ask: (bytes, ms) => new Promise((resolve) => {
      if (failed || socket.destroyed) { resolve(null); return; }
      const timer = setTimeout(() => { waiting = null; resolve(null); }, ms);
      waiting = (chunk) => { clearTimeout(timer); resolve(chunk); };
      socket.write(Buffer.from(bytes));
    }),
  };
}

/* A real-time status byte always has this shape (0xx1xx10); anything else is
   not an answer to the question. */
const statusByte = (chunk) => {
  const b = chunk?.length ? chunk[chunk.length - 1] : null;
  return b !== null && (b & 0x93) === 0x12 ? b : null;
};

/* ESC/POS real-time status (DLE EOT 1–4): is it online, is the cover shut,
   is there paper, is it in an error. Many printers answer; some budget ones
   do not over a network, and then all that is known is that the bytes left. */
async function readStatus(ear, { first = 600, next = 400 } = {}) {
  const s1 = statusByte(await ear.ask([0x10, 0x04, 0x01], first));
  if (s1 === null) return { answered: false };
  const s2 = statusByte(await ear.ask([0x10, 0x04, 0x02], next)) ?? 0x12;
  const s3 = statusByte(await ear.ask([0x10, 0x04, 0x03], next)) ?? 0x12;
  const s4 = statusByte(await ear.ask([0x10, 0x04, 0x04], next)) ?? 0x12;
  return {
    answered: true,
    online: !(s1 & 0x08),
    cover: s2 & 0x04 ? "open" : "closed",
    paper: (s2 & 0x20) || (s4 & 0x60) ? "out" : (s4 & 0x0c) ? "low" : "ok",
    error: Boolean((s2 & 0x40) || (s3 & 0x6c)),
  };
}

/* What stops a print, in the order a person would fix it. */
function blocking(status, { strict = true } = {}) {
  if (!status?.answered) return null;
  if (status.cover === "open") return "coveropen";
  if (status.paper === "out") return "paperout";
  if (status.error) return "printererror";
  if (strict && !status.online) return "offline";
  return null;
}

/* The printer's model, where it will say (GS I 67). */
async function readModel(ear) {
  const chunk = await ear.ask([0x1d, 0x49, 0x43], 500);
  if (!chunk?.length) return "";
  const s = chunk.toString("latin1").replace(/^_/, "").replace(/\0.*$/s, "").replace(/[^\x20-\x7e]/g, "").trim();
  return s.slice(0, 40);
}

/* ── Writing a job ──────────────────────────────────────────────────────── */

function writeAll(socket, data, onProgress, idleMs) {
  return new Promise((resolve, reject) => {
    let at = 0;
    let timer = null;
    const fail = (err) => { clearTimeout(timer); socket.removeListener("error", onError); reject(err); };
    const onError = (err) => fail(new PrintFailure(at > 0 ? "interrupted" : CODE_OF[err.code] || "refused", err.message));
    socket.once("error", onError);
    const step = () => {
      clearTimeout(timer);
      if (at >= data.length) { socket.removeListener("error", onError); resolve(); return; }
      const end = Math.min(data.length, at + 4096);
      timer = setTimeout(() => fail(new PrintFailure(at > 0 ? "interrupted" : "timeout", "the printer stopped taking data")), idleMs);
      socket.write(data.subarray(at, end), (err) => {
        if (err) return;
        at = end;
        onProgress(at);
        step();
      });
    };
    step();
  });
}

/* Close the connection. False only when the printer had already closed it,
   which is a job cut short.

   An error that turns up while closing is not held against the job. By then
   every byte has been taken and a quarter of a second has passed in silence;
   plenty of printers answer a goodbye with a reset instead of a goodbye of
   their own, and calling each of those a failure would have the till asking
   for a second copy of a ticket the kitchen already has. */
function hangUp(socket) {
  return new Promise((resolve) => {
    if (socket.destroyed) { resolve(false); return; }
    const timer = setTimeout(() => { socket.destroy(); resolve(true); }, 1500);
    socket.once("close", () => { clearTimeout(timer); resolve(true); });
    socket.end();
  });
}

/* Printers that did not answer a status question are not asked again for a
   while: the wait for an answer that is not coming is paid on every job. */
const silent = new Map();
const SILENT_FOR = 10 * 60 * 1000;

/* Write one job to one printer and say what is actually known about it.

   ok:true means every byte was handed to the printer and the connection
   closed cleanly. Where the printer answers status questions it also means
   it had paper and a closed cover before and after — `printer.answered`.
   Where it does not, nobody but a person at the printer knows that paper
   came out, and the answer says so rather than guessing. */
export async function sendToPrinter({ host, port, data, status = true, allow = [], connectMs = 5000, idleMs = 10000 }) {
  const started = Date.now();
  const key = `${host}:${port}`;
  let socket = null;
  let wrote = 0;
  let printer = { answered: false };
  try {
    const address = await resolveTarget(host, allow);
    socket = await connect(address, Number(port), connectMs);
    const ear = listen(socket);
    const quiet = (silent.get(key) || 0) > Date.now();
    if (status && !quiet) {
      printer = await readStatus(ear);
      if (!printer.answered) silent.set(key, Date.now() + SILENT_FOR);
      const stop = blocking(printer);
      if (stop) throw new PrintFailure(stop, "", { printer });
    }
    await writeAll(socket, data, (n) => { wrote = n; }, idleMs);
    if (printer.answered) {
      /* Roughly how long the paper takes: 72 bytes a row, 1600 rows a second. */
      await sleep(Math.min(5000, 300 + data.length / 72 / 1.6));
      const after = await readStatus(ear, { first: 800 });
      if (after.answered) {
        printer = after;
        const stop = blocking(after, { strict: false });
        if (stop) throw new PrintFailure(stop, "", { printer });
      }
    }
    /* A moment for the printer to take the last of it — and for bad news to
       arrive. Bytes handed to this computer's network stack are not bytes
       the printer has: a printer that dropped the line half-way through is
       only found out when it refuses what follows, a moment later. Without
       this wait that job was reported as printed. */
    await sleep(250);
    /* A printer keeps the line open until it is hung up on. One that closed
       it first — with an error or without one — has stopped listening,
       whatever it had taken by then, and by now this end is closed too. */
    if (!(await hangUp(socket))) {
      throw new PrintFailure("interrupted", ear.failed?.message || "the printer closed the connection before the job was finished");
    }
    return { ok: true, wrote, printer, ms: Date.now() - started };
  } catch (err) {
    socket?.destroy();
    const failure = err instanceof PrintFailure ? err : new PrintFailure("bridge", String(err?.message || err));
    return { ok: false, error: failure.code, detail: failure.detail, wrote, printer: failure.printer || printer, ms: Date.now() - started };
  }
}

/* Can the printer be reached, and what does it say? Prints nothing. */
export async function probePrinter({ host, port, allow = [], connectMs = 4000 }) {
  const started = Date.now();
  let socket = null;
  try {
    const address = await resolveTarget(host, allow);
    socket = await connect(address, Number(port), connectMs);
    const ear = listen(socket);
    const printer = await readStatus(ear);
    if (printer.answered) printer.model = await readModel(ear);
    else silent.set(`${host}:${port}`, Date.now() + SILENT_FOR);
    await hangUp(socket);
    return { ok: true, wrote: 0, printer, ms: Date.now() - started };
  } catch (err) {
    socket?.destroy();
    const failure = err instanceof PrintFailure ? err : new PrintFailure("bridge", String(err?.message || err));
    return { ok: false, error: failure.code, detail: failure.detail, wrote: 0, printer: { answered: false }, ms: Date.now() - started };
  }
}

/* ── What this bridge has already printed ───────────────────────────────── */

/* Kept on disk so that a job the server hands over twice is printed once,
   across a restart too, and so that an outcome the server did not hear is
   told again rather than lost. Only what printed is remembered as done: a
   job that failed is one the till may fairly ask for again. */
export function createMemory(file = null, limit = 300) {
  let saved = { server: "", token: "", printed: {}, unsent: {} };
  if (file) {
    try { saved = { ...saved, ...JSON.parse(fs.readFileSync(file, "utf8")) }; } catch { /* first run */ }
  }
  const write = () => {
    if (!file) return;
    const ids = Object.keys(saved.printed);
    for (const id of ids.slice(0, Math.max(0, ids.length - limit))) delete saved.printed[id];
    try { fs.writeFileSync(file, JSON.stringify(saved), { mode: 0o600 }); } catch { /* read-only disk: run without memory */ }
  };
  return {
    get server() { return saved.server; },
    get token() { return saved.token; },
    signIn(server, token) { saved.server = server; saved.token = token; write(); },
    printed: (id) => saved.printed[id] || null,
    record(id, outcome) {
      if (outcome.ok) saved.printed[id] = outcome;
      saved.unsent[id] = outcome;
      write();
    },
    unsent: () => Object.entries(saved.unsent).map(([id, outcome]) => ({ id, outcome })),
    told(id) { delete saved.unsent[id]; write(); },
  };
}

/* ── The loop ───────────────────────────────────────────────────────────── */

export function checkServer(server) {
  let url;
  try { url = new URL(server); } catch { throw new Error(`"${server}" is not an address. It should look like https://your-site`); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || isPrivateIPv4(url.hostname) || url.hostname.endsWith(".local");
  if (url.protocol !== "https:" && !local) throw new Error("The server address must start with https:// — the bridge's token must not travel in the clear.");
  return url.origin;
}

/* Runs until `signal` aborts. `rounds` is for tests: stop after that many
   polls. Everything it needs comes in, so it can be run against a server and
   a printer that are both in the same process. */
export async function runBridge({
  server, token, memory = createMemory(), fetchImpl = globalThis.fetch, log = () => {}, allow = [],
  wait = 20, idle = 3000, signal = null, rounds = Infinity, print = sendToPrinter, probe = probePrinter,
}) {
  const origin = checkServer(server);
  const headers = { Authorization: `Bearer ${token}`, "x-bridge-version": VERSION, "x-bridge-machine": os.hostname().slice(0, 60) };
  const call = async (method, what, { query = {}, body = null, timeout = 15000 } = {}) => {
    const qs = new URLSearchParams({ what, ...query }).toString();
    const res = await fetchImpl(`${origin}/api/print?${qs}`, {
      method,
      headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json) { const e = new Error(json?.error || `http ${res.status}`); e.status = res.status; throw e; }
    return json;
  };
  const tell = async (id, outcome) => {
    try {
      await call("POST", "done", { body: { id, ...outcome } });
      memory.told(id);
      return true;
    } catch (err) {
      /* A job the server no longer has is not one to keep telling it about. */
      if (err.status === 404 || err.status === 403) { memory.told(id); return true; }
      return false;
    }
  };

  let down = false;
  let pause = 2000;
  for (let round = 0; round < rounds && !signal?.aborted; round += 1) {
    try {
      for (const { id, outcome } of memory.unsent()) { if (!(await tell(id, outcome))) break; }
      const { jobs = [] } = await call("GET", "claim", { query: { wait: String(wait) }, timeout: (wait + 15) * 1000 });
      if (down) { log("Connected to PureMargin again."); down = false; }
      pause = 2000;
      /* Asked not to be kept waiting (`--wait 0`), so the asking is spaced
         out here instead: an answer of "nothing" must not be followed at
         once by the same question. */
      if (!jobs.length && wait < 1 && round + 1 < rounds) await sleep(idle);
      for (const job of jobs) {
        const where = `${job.host}:${job.port}`;
        let outcome = job.kind === "print" ? memory.printed(job.id) : null;
        if (outcome) {
          log(`${job.label} ${job.id} was already printed on ${where}; not printing it again.`);
        } else if (job.kind === "probe") {
          outcome = await probe({ host: job.host, port: job.port, allow });
          log(outcome.ok ? `${where} answers${outcome.printer?.answered ? " and reports its status" : ""}.` : `${where} could not be reached (${outcome.error}).`);
        } else {
          outcome = await print({ host: job.host, port: job.port, data: Buffer.from(job.data || "", "base64"), status: job.status !== false, allow });
          log(outcome.ok
            ? `${job.label} sent to ${where} (${outcome.wrote} bytes${outcome.printer?.answered ? ", printer reports ready" : ", printer does not report status"}).`
            : `${job.label} for ${where} did not print: ${outcome.error}${outcome.detail ? ` — ${outcome.detail}` : ""}.`);
        }
        memory.record(job.id, outcome);
        await tell(job.id, outcome);
      }
    } catch (err) {
      if (signal?.aborted) break;
      if (err.status === 401 || err.status === 403) {
        log("PureMargin did not accept this bridge's token. It may have been removed in the register's printer settings; make a new one there.");
        pause = 30000;
      } else if (!down) {
        log(`Cannot reach PureMargin (${err.message}). Trying again; nothing can print until it is back.`);
        down = true;
      }
      if (round + 1 < rounds) await sleep(pause);
      pause = Math.min(15000, pause * 1.5);
    }
  }
}

/* ── From the command line ──────────────────────────────────────────────── */

const RAW_PORTS = [9100, 9101, 9102, 6001];
const OTHER_PORTS = { 515: "LPD", 631: "IPP / AirPrint", 80: "web page", 443: "web page (https)", 8008: "Epson ePOS", 8043: "Epson ePOS (https)" };

function splitAddress(value, fallbackPort = 9100) {
  const [host, port] = String(value || "").split(":");
  return { host, port: Number(port) || fallbackPort };
}

async function portOpen(address, port) {
  try { const s = await connect(address, port, 2000); s.destroy(); return true; } catch { return false; }
}

async function probeCommand(value, allow, out) {
  const { host } = splitAddress(value);
  let address;
  try { address = await resolveTarget(host, allow); }
  catch (err) { out(`Cannot probe ${host}: ${err.detail || err.code}.`); return 1; }
  out(`Probing ${address} from ${os.hostname()} …`);
  const usable = [];
  for (const port of RAW_PORTS) {
    if (!(await portOpen(address, port))) { out(`  port ${port}   no answer`); continue; }
    const result = await probePrinter({ host: address, port, allow });
    const p = result.printer || {};
    usable.push(port);
    out(`  port ${port}   OPEN — takes raw print data` + (p.answered
      ? `; reports status: ${p.online ? "online" : "offline"}, cover ${p.cover}, paper ${p.paper}${p.model ? `; model "${p.model}"` : ""}`
      : "; does not answer ESC/POS status questions"));
  }
  for (const [port, what] of Object.entries(OTHER_PORTS)) {
    if (await portOpen(address, Number(port))) out(`  port ${port}   open (${what})`);
  }
  if (!usable.length) {
    out("\nNothing answered on a raw printing port. Check the cable and that this computer is on the same network as the printer (same first three numbers of the IP address).");
    return 1;
  }
  out(`\nUse port ${usable[0]} in PureMargin. To see paper come out:  node print-bridge.mjs --test ${address}:${usable[0]}`);
  return 0;
}

async function testCommand(value, allow, out) {
  const { host, port } = splitAddress(value);
  const line = (s) => Buffer.from(`${s}\n`, "latin1");
  const data = Buffer.concat([
    Buffer.from([0x1b, 0x40, 0x1b, 0x61, 0x01, 0x1b, 0x45, 0x01]), line("PureMargin print bridge"),
    Buffer.from([0x1b, 0x45, 0x00]), line("Test page"), Buffer.from([0x1b, 0x61, 0x00]),
    line("--------------------------------"), line(`Printer  ${host}:${port}`), line(`From     ${os.hostname()}`),
    line(`Time     ${new Date().toISOString()}`), line("--------------------------------"),
    line("If you can read this, the printer"), line("takes ESC/POS on this port."),
    Buffer.from([0x1b, 0x64, 0x04, 0x1d, 0x56, 0x42, 0x00]),
  ]);
  const result = await sendToPrinter({ host, port, data, allow });
  if (!result.ok) { out(`Did not print: ${result.error}${result.detail ? ` — ${result.detail}` : ""}.`); return 1; }
  out(`Sent ${result.wrote} bytes to ${host}:${port}. ${result.printer.answered
    ? `The printer reports: cover ${result.printer.cover}, paper ${result.printer.paper}.`
    : "The printer does not report its status, so look at it: a short page should have come out and been cut."}`);
  return 0;
}

async function main(argv) {
  const args = {};
  const allow = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--allow") allow.push(String(argv[i += 1] || "").toLowerCase());
    else if (a.startsWith("--")) args[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i += 1] : true;
  }
  const out = (s) => console.log(s);
  if (args.help || args.h) {
    out("PureMargin print bridge " + VERSION);
    out("  node print-bridge.mjs --server https://your-site --token B.xxxxx   run (remembered for next time)");
    out("  node print-bridge.mjs                                              run with what was remembered");
    out("  node print-bridge.mjs --probe 192.168.8.19                         what a printer answers on");
    out("  node print-bridge.mjs --test 192.168.8.19:9100                     print a test page from here");
    out("  --allow <address>   also allow a printer that is not on a private network");
    out("  --wait <seconds>    how long each request for work is held open (default 20, at most 25).");
    out("                      0 asks every few seconds instead: a moment slower to start printing,");
    out("                      and kinder to a host that charges for the time a request stays open.");
    return 0;
  }
  if (args.probe) return probeCommand(args.probe, allow, out);
  if (args.test) return testCommand(args.test, allow, out);

  const file = typeof args.state === "string" ? args.state : path.join(os.homedir(), ".puremargin-print-bridge.json");
  const memory = createMemory(file);
  const server = String(args.server || process.env.PUREMARGIN_SERVER || memory.server || "");
  const token = String(args.token || process.env.PUREMARGIN_BRIDGE_TOKEN || memory.token || "");
  if (!server || !token) {
    out("This bridge has not been set up yet. In the register: Settings → Printers → Print bridge → Add a bridge,");
    out("then run the command shown there. (node print-bridge.mjs --help for everything else.)");
    return 1;
  }
  try { checkServer(server); } catch (err) { out(err.message); return 1; }
  memory.signIn(server, token);
  const stamp = () => new Date().toLocaleTimeString();
  out(`PureMargin print bridge ${VERSION} — waiting for print jobs from ${new URL(server).host}. Leave this running.`);
  const stop = new AbortController();
  process.on("SIGINT", () => { stop.abort(); process.exit(0); });
  const wait = args.wait === undefined || args.wait === true ? 20 : Math.max(0, Math.min(25, Number(args.wait) || 0));
  await runBridge({ server, token, memory, allow, wait, signal: stop.signal, log: (s) => out(`[${stamp()}] ${s}`) });
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => { if (code) process.exit(code); });
}
