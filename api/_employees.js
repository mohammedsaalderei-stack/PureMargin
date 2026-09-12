import { createHash, randomInt } from "node:crypto";
import { getJSON, setJSON } from "./_store.js";

/* Who works here, and when they were actually here.

   ── Why this is not the Team screen ──────────────────────────────────────

   A team member is an account: an email, a password, a role, permission to see
   the margin. Most people who work in a restaurant have none of that and never
   will — they arrive, they work, they leave. Making a kitchen porter an
   account with a login to record that they turned up is asking the wrong thing
   of them and putting a person who cannot read the P&L one misconfigured role
   away from it.

   So an employee is a record, not a user. The two are deliberately separate
   and neither is derived from the other.

   ── The PIN, and what it is honestly worth ───────────────────────────────

   Attendance recorded by a manager ticking names is a record of what the
   manager believes. The PIN moves it one step closer to evidence: the code is
   the employee's, so a punch says somebody who knew it was standing at the
   device. That is worth having and it is not proof of identity — a code can be
   passed to a friend, and any attendance system without a camera or a badge
   has the same hole. It is stated here rather than implied so nobody builds
   payroll on it believing it is more than it is.

   Stored hashed, which is also worth being honest about: six digits is a
   million combinations and a machine walks that in no time, so the hash is not
   protecting a secret the way a password hash does. What it does buy is that a
   copy of the store is not a working list of everybody's code, and that the
   screen cannot show one back — which is what forces a lost PIN to be rotated
   rather than looked up, and rotation is the thing that actually limits how
   long a passed-around code keeps working.

   ── Attendance is a ledger, like everything else here ────────────────────

   Punches are appended and never edited. Who is on shift right now is derived
   by walking them, exactly as a stock balance is derived from movements. A
   stored "present" flag would be a second truth for the same fact, and the
   first thing to go wrong when a phone loses signal mid-punch. */

const ROSTER = (orgId) => `staff:${orgId}:employees`;
const PUNCHES = (orgId) => `staff:${orgId}:punches`;

/* Six digits, not four. Four is ten thousand codes, and a venue with thirty
   people has a real chance of two colliding — at which point one person's
   arrival is recorded against another, which is worse than no record. */
const PIN_DIGITS = 6;

/* Enough for a year of a busy roster. Trimmed oldest-first; an old punch has
   been paid and does not need to stay in the hot path forever. */
const MAX_PUNCHES = 20000;

export function hashPin(orgId, pin) {
  return createHash("sha256").update(`${orgId}:${String(pin).trim()}`).digest("hex");
}

/* A code that is not already somebody's.

   Uniqueness is the whole reason a PIN can identify anybody: two employees
   sharing one makes a punch ambiguous, and the honest thing to do with an
   ambiguous punch is refuse it — which would strand whoever arrived second.

   Compared as hashes because that is the only form the stored ones exist in.
   Archived people count: a punch resolves by hash and does not know whether
   its owner still works here, so reissuing a leaver's code would attach one
   person's arrival to another's name. */
function freshPin(orgId, usedHashes) {
  for (let tries = 0; tries < 200; tries += 1) {
    const pin = String(randomInt(0, 10 ** PIN_DIGITS)).padStart(PIN_DIGITS, "0");
    if (!usedHashes.has(hashPin(orgId, pin))) return pin;
  }
  return null;
}

export async function listEmployees(orgId, { includeArchived = false } = {}) {
  const all = Object.values((await getJSON(ROSTER(orgId))) || {});
  const live = includeArchived ? all : all.filter((e) => !e.archived);
  return live.sort((a, b) => a.name.localeCompare(b.name));
}

let counter = 0;
const newId = () =>
  `e${Date.now().toString(36)}${(counter = (counter + 1) % 1e4).toString(36).padStart(3, "0")}`;

/* Add somebody, with a code issued on the spot.

   The PIN comes back in clear exactly once, here, because this is the one
   moment it can be handed over. Nothing stores it and no later read can
   produce it. */
export async function addEmployee(orgId, { name, title, branchId }) {
  const clean = String(name || "").trim().slice(0, 80);
  if (!clean) return { error: "name" };

  const map = (await getJSON(ROSTER(orgId))) || {};
  const rows = Object.values(map);

  if (rows.some((e) => !e.archived && e.name.trim().toLowerCase() === clean.toLowerCase())) {
    return { error: "duplicate" };
  }

  const chosen = freshPin(orgId, new Set(rows.map((e) => e.pinHash).filter(Boolean)));
  if (!chosen) return { error: "collision" };
  const hash = hashPin(orgId, chosen);

  const record = {
    id: newId(),
    name: clean,
    title: String(title || "").trim().slice(0, 60),
    /* Where they work, when the org has more than one place. Null means "any",
       which is the right answer for a floater and for a single-site business
       that should not be asked the question at all. */
    branchId: String(branchId || "").trim() || null,
    pinHash: hash,
    pinSetAt: Date.now(),
    archived: false,
    createdAt: Date.now(),
  };

  map[record.id] = record;
  await setJSON(ROSTER(orgId), map);
  return { employee: record, pin: chosen };
}

export async function updateEmployee(orgId, id, { name, title, branchId }) {
  const map = (await getJSON(ROSTER(orgId))) || {};
  const existing = map[String(id)];
  if (!existing) return { error: "notfound" };

  map[existing.id] = {
    ...existing,
    name: name === undefined ? existing.name : String(name).trim().slice(0, 80) || existing.name,
    title: title === undefined ? existing.title : String(title || "").trim().slice(0, 60),
    branchId: branchId === undefined
      ? existing.branchId
      : (String(branchId || "").trim() || null),
    updatedAt: Date.now(),
  };
  await setJSON(ROSTER(orgId), map);
  return { employee: map[existing.id] };
}

/* A new code for somebody who lost theirs, or whose old one got around.

   The only way back to a working PIN, by design: nothing can read the old one
   out, so "what was my code" is always answered by issuing another. */
export async function rotatePin(orgId, id) {
  const map = (await getJSON(ROSTER(orgId))) || {};
  const existing = map[String(id)];
  if (!existing) return { error: "notfound" };

  const chosen = freshPin(orgId, new Set(Object.values(map).map((e) => e.pinHash).filter(Boolean)));
  if (!chosen) return { error: "collision" };

  map[existing.id] = { ...existing, pinHash: hashPin(orgId, chosen), pinSetAt: Date.now() };
  await setJSON(ROSTER(orgId), map);
  return { employee: map[existing.id], pin: chosen };
}

/* Archived, never deleted, for the reason the stock ledger is: a punch from
   March has to stay resolvable to the person who made it. */
export async function archiveEmployee(orgId, id, { archived = true } = {}) {
  const map = (await getJSON(ROSTER(orgId))) || {};
  const existing = map[String(id)];
  if (!existing) return { error: "notfound" };
  map[existing.id] = { ...existing, archived: Boolean(archived), updatedAt: Date.now() };
  await setJSON(ROSTER(orgId), map);
  return { employee: map[existing.id] };
}

export async function findByPin(orgId, pin) {
  const clean = String(pin || "").trim();
  if (!/^\d{4,8}$/.test(clean)) return null;
  const hash = hashPin(orgId, clean);
  const rows = Object.values((await getJSON(ROSTER(orgId))) || {});
  return rows.find((e) => e.pinHash === hash && !e.archived) || null;
}

/* ── Punches ──────────────────────────────────────────────── */

export async function listPunches(orgId, { from, to, employeeId, branchId } = {}) {
  const all = (await getJSON(PUNCHES(orgId))) || [];
  return all.filter((p) =>
    (from === undefined || p.at >= from)
    && (to === undefined || p.at <= to)
    && (!employeeId || p.employeeId === String(employeeId))
    && (!branchId || String(p.branchId) === String(branchId)));
}

/* Who is on shift, worked out from the punches rather than stored.

   The last punch of the day for each person decides: in means present, out
   means gone. Nothing is written to say so, which is what stops the flag and
   the log disagreeing after a punch that half-succeeded. */
export function onShift(punches) {
  const last = new Map();
  for (const p of [...punches].sort((a, b) => a.at - b.at)) last.set(p.employeeId, p);
  return [...last.values()].filter((p) => p.kind === "in");
}

/* Record an arrival or a departure.

   Which of the two it is, is not asked. Somebody arriving for a shift should
   not have to tell the machine which button this is — the machine already
   knows whether they are currently in, and asking invites the wrong answer at
   the end of a long day. */
export async function punch(orgId, { employeeId, branchId, at = Date.now(), actor = "" }) {
  const all = (await getJSON(PUNCHES(orgId))) || [];

  /* Their most recent punch, with ties broken by which was recorded last.

     `reduce((a, b) => a.at > b.at ? a : b)` looks right and is not: when two
     punches carry the same millisecond — which three quick taps on a pad do —
     the comparison is false every time and it walks to the end of the array
     instead. The list is kept newest-recorded first, so seeding the reduce
     with the head and only moving on a strict improvement keeps the head when
     the times are equal. */
  const theirs = all.filter((p) => p.employeeId === String(employeeId));
  const last = theirs.length
    ? theirs.reduce((a, b) => (b.at > a.at ? b : a), theirs[0])
    : null;
  const kind = last && last.kind === "in" ? "out" : "in";

  const entry = {
    id: `p${Date.now().toString(36)}${(counter = (counter + 1) % 1e4).toString(36).padStart(3, "0")}`,
    employeeId: String(employeeId),
    branchId: String(branchId || "") || null,
    kind,
    at,
    /* Which signed-in account's device this was taken on. Not who punched —
       that is the PIN — but where the record came from, which is what makes a
       disputed punch answerable at all. */
    actor: String(actor || "").slice(0, 80),
  };

  const next = [entry, ...all].slice(0, MAX_PUNCHES);
  await setJSON(PUNCHES(orgId), next);

  /* How long that shift ran, where this closed one. Reported rather than
     stored: it is the difference between two entries that are both already
     there, and storing it would be a third copy of the same fact. */
  const workedMs = kind === "out" && last ? entry.at - last.at : null;
  return { punch: entry, kind, workedMs, since: kind === "out" ? last?.at ?? null : entry.at };
}

/* Every completed stretch of work in a window, per person.

   An unmatched "in" is reported with no end rather than silently paired with
   the next day's, because somebody who forgot to punch out is a thing a
   manager has to see, not a thirteen-hour shift to pay. */
export function shiftsFrom(punches) {
  const byPerson = new Map();
  for (const p of [...punches].sort((a, b) => a.at - b.at)) {
    if (!byPerson.has(p.employeeId)) byPerson.set(p.employeeId, []);
    byPerson.get(p.employeeId).push(p);
  }

  const out = [];
  for (const [employeeId, list] of byPerson) {
    let open = null;
    for (const p of list) {
      if (p.kind === "in") {
        /* Two arrivals with no departure between them: the first is left open
           and reported, rather than overwritten. */
        if (open) out.push({ employeeId, branchId: open.branchId, in: open.at, out: null, ms: null });
        open = p;
      } else if (open) {
        out.push({ employeeId, branchId: open.branchId, in: open.at, out: p.at, ms: p.at - open.at });
        open = null;
      } else {
        out.push({ employeeId, branchId: p.branchId, in: null, out: p.at, ms: null });
      }
    }
    if (open) out.push({ employeeId, branchId: open.branchId, in: open.at, out: null, ms: null });
  }
  return out.sort((a, b) => (b.in || b.out || 0) - (a.in || a.out || 0));
}
