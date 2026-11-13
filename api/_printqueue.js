/* The print queue: how a web page reaches a printer on the shop's network.

   A page in Safari cannot open a socket, so it cannot talk to a receipt
   printer on the LAN however the form is filled in. What it can do is hand
   the finished bytes to this queue. A small program inside the shop — the
   print bridge — asks the queue for work over HTTPS, writes each job to the
   printer over TCP, and says what happened:

       register → this queue → bridge (in the shop) → printer

   The bridge only ever calls out. Nothing listens on the shop's network for
   the internet, and the printer's port is never exposed.

   ── What is deliberately true here ──────────────────────────────────────

   A job has the id the till gave it. Sending the same id again returns what
   became of the first one; it is never queued twice. That is the whole of
   duplicate prevention: a retry that does not know whether its first attempt
   printed asks under the same id and finds out.

   A job goes only to a printer somebody with the register's settings rights
   has registered (`targets`). Without that, any cashier's session could have
   the bridge write arbitrary bytes to any address inside the shop — the
   router's admin page included.

   A job that was handed to a bridge which then went quiet is `unconfirmed`,
   not failed and not queued again. It may be on paper. Printing it again is
   a person's decision, made by looking at the printer.

   A job nobody collected within `JOB_TTL` is failed, not kept. A kitchen
   order that prints twenty minutes late, after somebody has written it out
   by hand, is a second order.

   Nothing here knows what a receipt is. The bytes arrive built. */

import crypto from "crypto";
import zlib from "zlib";
import { getJSON, setJSON, del, listJSON } from "./_store.js";
import { signScoped } from "./_auth.js";

export const JOB_TTL = 90 * 1000;        // uncollected for this long: failed
export const LEASE_MS = 60 * 1000;       // collected, no word for this long: unconfirmed
export const ONLINE_MS = 45 * 1000;      // a bridge not heard from for this long is offline
export const KEEP_MS = 60 * 60 * 1000;   // how long a finished job's outcome is kept
export const MAX_BYTES = 3 * 1024 * 1024;
const MAX_BRIDGES = 5;
const MAX_TARGETS = 20;
const SEEN_EVERY = 15 * 1000;

const bridgesKey = (org) => `print:${org}:bridges`;
const targetsKey = (org) => `print:${org}:targets`;
const wakeKey = (org) => `print:${org}:wake`;
const jobKey = (org, id) => `print:${org}:job:${id}`;
const jobPrefix = (org) => `print:${org}:job:`;
const dataKey = (org, id) => `print:${org}:data:${id}`;

const text = (v, max) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
const b64 = (s) => Buffer.from(String(s)).toString("base64url");

/* ── Where a job may go ─────────────────────────────────────────────────── */

/* An address inside a building: 10/8, 172.16/12, 192.168/16, and link-local.
   Loopback is not one — that is the bridge's own machine. */
export function isPrivateIPv4(host) {
  const m = String(host).match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((n) => n > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

/* A printer's address: a private IPv4 address, or a name on the local
   network ("printer", "tm-m30.local"). A name is resolved by the bridge,
   which refuses it unless it comes out as a private address. */
export function readTarget(input) {
  const host = text(input?.host, 80).toLowerCase();
  const port = Number(input?.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: "port" };
  const named = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.local)?$/.test(host) && !/^\d+$/.test(host);
  if (!isPrivateIPv4(host) && !named) return { error: "host" };
  return { host, port };
}

export const targetKeyOf = (host, port) => `${String(host).toLowerCase()}:${Number(port)}`;

export async function listTargets(orgId) {
  const list = await getJSON(targetsKey(orgId));
  return Array.isArray(list) ? list : [];
}

export async function addTarget(orgId, input, { by = "", now = Date.now() } = {}) {
  const t = readTarget(input);
  if (t.error) return t;
  const bridges = await listBridges(orgId);
  if (!bridges.length) return { error: "nobridge" };
  const bridgeId = bridges.some((b) => b.id === input?.bridgeId) ? String(input.bridgeId) : bridges[0].id;
  const list = await listTargets(orgId);
  const key = targetKeyOf(t.host, t.port);
  const rest = list.filter((x) => targetKeyOf(x.host, x.port) !== key);
  if (rest.length >= MAX_TARGETS) return { error: "toomany" };
  const target = { host: t.host, port: t.port, bridgeId, name: text(input?.name, 40), addedBy: text(by, 60), addedAt: now };
  await setJSON(targetsKey(orgId), [...rest, target]);
  return { target, added: rest.length === list.length };
}

export async function removeTarget(orgId, host, port) {
  const list = await listTargets(orgId);
  const key = targetKeyOf(host, port);
  const rest = list.filter((x) => targetKeyOf(x.host, x.port) !== key);
  if (rest.length === list.length) return { error: "notfound" };
  await setJSON(targetsKey(orgId), rest);
  return { ok: true };
}

/* ── Bridges ────────────────────────────────────────────────────────────── */

export async function listBridges(orgId) {
  const list = await getJSON(bridgesKey(orgId));
  return Array.isArray(list) ? list : [];
}

export const bridgeOnline = (bridge, now = Date.now()) => Boolean(bridge?.lastSeenAt) && now - bridge.lastSeenAt < ONLINE_MS;

/* The token a bridge signs in with. It names the business and the bridge and
   nothing else, is signed under its own label so it can never pass as a
   session, and stops working the moment the bridge is removed — the check is
   against the list, not just the signature. Shown once, when it is made. */
function tokenFor(orgId, bridgeId) {
  const payload = `B.${b64(orgId)}.${bridgeId}`;
  return `${payload}.${signScoped("printbridge", payload)}`;
}

export async function createBridge(orgId, { name = "", by = "", now = Date.now() } = {}) {
  const list = await listBridges(orgId);
  if (list.length >= MAX_BRIDGES) return { error: "toomany" };
  const bridge = {
    id: `b${crypto.randomBytes(6).toString("hex")}`,
    name: text(name, 40) || `Bridge ${list.length + 1}`,
    createdAt: now, createdBy: text(by, 60), lastSeenAt: 0, version: "", machine: "",
  };
  await setJSON(bridgesKey(orgId), [...list, bridge]);
  return { bridge, token: tokenFor(orgId, bridge.id) };
}

/* Removing a bridge removes the printers it reached: a printer nobody can
   reach is a job that can only fail. */
export async function removeBridge(orgId, id) {
  const list = await listBridges(orgId);
  if (!list.some((b) => b.id === id)) return { error: "notfound" };
  await setJSON(bridgesKey(orgId), list.filter((b) => b.id !== id));
  const targets = await listTargets(orgId);
  if (targets.some((t) => t.bridgeId === id)) await setJSON(targetsKey(orgId), targets.filter((t) => t.bridgeId !== id));
  return { ok: true };
}

/* Who is calling, from a bridge token: `{ orgId, bridge }`, or null. */
export async function readBridgeToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 4 || parts[0] !== "B") return null;
  const payload = parts.slice(0, 3).join(".");
  const a = Buffer.from(parts[3]);
  const b = Buffer.from(signScoped("printbridge", payload));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const orgId = Buffer.from(parts[1], "base64url").toString();
  const bridge = (await listBridges(orgId)).find((x) => x.id === parts[2]);
  return bridge ? { orgId, bridge } : null;
}

/* A bridge said hello. Written at most every few seconds: this is called on
   every poll, and a write per poll is a write a second for nothing. */
export async function touchBridge(orgId, id, { now = Date.now(), version = "", machine = "" } = {}) {
  const list = await listBridges(orgId);
  const bridge = list.find((b) => b.id === id);
  if (!bridge) return null;
  const changed = (version && bridge.version !== version) || (machine && bridge.machine !== machine);
  if (!changed && now - (bridge.lastSeenAt || 0) < SEEN_EVERY) return bridge;
  const next = { ...bridge, lastSeenAt: now, version: text(version, 20) || bridge.version, machine: text(machine, 60) || bridge.machine };
  await setJSON(bridgesKey(orgId), list.map((b) => (b.id === id ? next : b)));
  return next;
}

/* ── Jobs ───────────────────────────────────────────────────────────────── */

const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9:_.-]{5,79}$/;
const KINDS = ["print", "probe"];
const LABELS = ["receipt", "kitchen", "shift", "test", "drawer", "probe"];
const DONE = ["printed", "failed"];

/* What the till is told about a job: never the bytes. */
export function publicJob(job) {
  if (!job) return null;
  const { id, kind, label, host, port, state, error, attempts, createdAt, doneAt, confirmed, printer, ms } = job;
  return { id, kind, label, host, port, state, error: error || null, attempts: attempts || 0, createdAt, doneAt: doneAt || null,
    confirmed: Boolean(confirmed), printer: printer || null, ms: ms ?? null };
}

/* A job as it stands now. Time passing changes a job with nobody writing to
   it — uncollected becomes failed, unanswered becomes unconfirmed — so that
   is settled here, on read, and written back. */
async function settle(orgId, job, now) {
  if (!job || DONE.includes(job.state)) return job;
  let next = null;
  if (job.state === "queued" && now - job.createdAt > JOB_TTL) next = { ...job, state: "failed", error: "expired", doneAt: now };
  if (job.state === "sending" && now > job.leaseUntil) next = { ...job, state: "failed", error: "unconfirmed", doneAt: now };
  if (!next) return job;
  await setJSON(jobKey(orgId, job.id), next);
  await del(dataKey(orgId, job.id));
  return next;
}

export async function getJob(orgId, id, now = Date.now()) {
  if (!JOB_ID.test(String(id || ""))) return null;
  return settle(orgId, await getJSON(jobKey(orgId, id)), now);
}

/* Queue a job, or say what became of the one already queued under this id.

   `retry` re-queues a job that definitely did not print — the printer was
   unreachable, the paper was out. It does not re-queue an `unconfirmed`
   one: that needs a new id, which is the till saying a person chose to. */
export async function enqueue(orgId, input, { by = "", now = Date.now() } = {}) {
  const id = String(input?.id || "");
  if (!JOB_ID.test(id)) return { error: "id" };
  const kind = KINDS.includes(input?.kind) ? input.kind : "print";
  const t = readTarget(input);
  if (t.error) return t;

  const existing = await getJob(orgId, id, now);
  const again = existing && existing.state === "failed" && existing.error !== "unconfirmed" && input?.retry === true;
  if (existing && !again) return { job: existing, duplicate: true };

  const target = (await listTargets(orgId)).find((x) => targetKeyOf(x.host, x.port) === targetKeyOf(t.host, t.port));
  if (!target) return { error: "notarget" };
  const bridge = (await listBridges(orgId)).find((b) => b.id === target.bridgeId);
  if (!bridge) return { error: "nobridge" };
  if (!bridgeOnline(bridge, now)) return { error: "bridgeoffline", bridge: bridge.name, lastSeenAt: bridge.lastSeenAt || null };

  let bytes = null;
  if (kind === "print") {
    if (typeof input?.data !== "string" || !input.data || input.data.length > MAX_BYTES * 1.4) return { error: "data" };
    bytes = Buffer.from(input.data, "base64");
    if (!bytes.length || bytes.length > MAX_BYTES) return { error: "data" };
  }

  const job = {
    id, kind, label: LABELS.includes(input?.label) ? input.label : kind === "probe" ? "probe" : "receipt",
    host: t.host, port: t.port, bridgeId: bridge.id, status: input?.status !== false,
    state: "queued", attempts: existing?.attempts || 0, size: bytes?.length || 0,
    createdAt: now, by: text(by, 60),
  };
  /* The bytes go in first: a job a bridge can see must have something to print. */
  if (bytes) await setJSON(dataKey(orgId, id), { z: zlib.deflateSync(bytes).toString("base64") });
  await setJSON(jobKey(orgId, id), job);
  await setJSON(wakeKey(orgId), { at: now });
  return { job, queued: true };
}

/* Is there anything a bridge might collect? One small read, which is all a
   poll costs while the shop is quiet. */
export async function mayHaveWork(orgId, now = Date.now()) {
  const wake = await getJSON(wakeKey(orgId));
  return Boolean(wake?.at) && now - wake.at <= JOB_TTL + LEASE_MS;
}

/* Hand a bridge its queued jobs, oldest first, marking each as sent out.
   Also where old outcomes are thrown away — the list is already in hand. */
export async function claim(orgId, bridgeId, { now = Date.now(), max = 4 } = {}) {
  const rows = await listJSON(jobPrefix(orgId));
  const out = [];
  const queued = [];
  for (const { value } of rows) {
    if (!value?.id) continue;
    if (DONE.includes(value.state) && now - (value.doneAt || value.createdAt) > KEEP_MS) { await del(jobKey(orgId, value.id)); continue; }
    const job = await settle(orgId, value, now);
    if (job.state === "queued" && job.bridgeId === bridgeId) queued.push(job);
  }
  queued.sort((a, b) => a.createdAt - b.createdAt);
  for (const job of queued.slice(0, max)) {
    const blob = job.kind === "print" ? await getJSON(dataKey(orgId, job.id)) : null;
    if (job.kind === "print" && !blob?.z) {
      await setJSON(jobKey(orgId, job.id), { ...job, state: "failed", error: "data", doneAt: now });
      continue;
    }
    const taken = { ...job, state: "sending", claimedAt: now, leaseUntil: now + LEASE_MS, attempts: (job.attempts || 0) + 1 };
    await setJSON(jobKey(orgId, job.id), taken);
    out.push({
      id: job.id, kind: job.kind, label: job.label, host: job.host, port: job.port, status: job.status !== false,
      data: blob ? zlib.inflateSync(Buffer.from(blob.z, "base64")).toString("base64") : null,
    });
  }
  return out;
}

const ERRORS = ["unreachable", "refused", "timeout", "interrupted", "notallowed", "notfound", "paperout", "coveropen", "offline", "printererror", "data", "bridge"];

/* What the bridge says happened. A late answer for a job already written off
   as unconfirmed replaces the guess with the fact. */
export async function report(orgId, bridgeId, input, { now = Date.now() } = {}) {
  const id = String(input?.id || "");
  if (!JOB_ID.test(id)) return { error: "id" };
  const job = await getJSON(jobKey(orgId, id));
  if (!job) return { error: "notfound" };
  if (job.bridgeId !== bridgeId) return { error: "forbidden" };
  if (job.state === "printed") return { job };
  const ok = input?.ok === true;
  const printer = input?.printer && typeof input.printer === "object" ? {
    answered: Boolean(input.printer.answered),
    online: input.printer.online !== false,
    cover: input.printer.cover === "open" ? "open" : "closed",
    paper: ["out", "low"].includes(input.printer.paper) ? input.printer.paper : "ok",
    error: Boolean(input.printer.error),
    model: text(input.printer.model, 40),
  } : null;
  const next = {
    ...job,
    state: ok ? "printed" : "failed",
    error: ok ? null : (ERRORS.includes(input?.error) ? input.error : "bridge"),
    detail: ok ? "" : text(input?.detail, 160),
    confirmed: ok && Boolean(printer?.answered),
    printer,
    wrote: Math.max(0, Number(input?.wrote) || 0),
    ms: Math.max(0, Math.min(600000, Number(input?.ms) || 0)),
    doneAt: now,
  };
  delete next.leaseUntil;
  await setJSON(jobKey(orgId, id), next);
  await del(dataKey(orgId, id));
  return { job: next };
}

/* Everything the settings screen shows: the bridges, whether each is
   answering, and the printers jobs may go to. */
export async function printSetup(orgId, now = Date.now()) {
  const [bridges, targets] = await Promise.all([listBridges(orgId), listTargets(orgId)]);
  return {
    bridges: bridges.map((b) => ({ id: b.id, name: b.name, createdAt: b.createdAt, lastSeenAt: b.lastSeenAt || null,
      online: bridgeOnline(b, now), version: b.version || "", machine: b.machine || "" })),
    targets: targets.map((t) => ({ host: t.host, port: t.port, name: t.name || "", bridgeId: t.bridgeId })),
  };
}
