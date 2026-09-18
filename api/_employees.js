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

   ── There was a PIN here, and it was the wrong idea ──────────────────────

   Every employee used to be issued a six-digit code and typed it into a pad
   on a device at the pass. This file said outright what that was worth: it
   proved somebody who knew the code was standing at the device, and a code
   can be passed to a friend. It also asked a person arriving for a shift to
   remember a number, and asked the venue to own a device and leave it signed
   in all day.

   It is gone. A shift is now recorded from `api/attendance.js`: the arriving
   person, on their own phone, on the open site, with a photograph of the
   place attached. That is not identity either, and that file says so at the
   same length — but it is evidence an owner can look at and judge, which a
   number they could never see was not.

   A manager can still record a punch for somebody who forgot. That path needs
   `manage:staff` and writes down whose session did it.

   ── Attendance is a ledger, like everything else here ────────────────────

   Punches are appended and never edited. Who is on shift right now is derived
   by walking them, exactly as a stock balance is derived from movements. A
   stored "present" flag would be a second truth for the same fact, and the
   first thing to go wrong when a phone loses signal mid-punch. */

const ROSTER = (orgId) => `staff:${orgId}:employees`;
const PUNCHES = (orgId) => `staff:${orgId}:punches`;

/* Enough for a year of a busy roster. Trimmed oldest-first; an old punch has
   been paid and does not need to stay in the hot path forever. */
const MAX_PUNCHES = 20000;

export async function listEmployees(orgId, { includeArchived = false } = {}) {
  const all = Object.values((await getJSON(ROSTER(orgId))) || {});
  const live = includeArchived ? all : all.filter((e) => !e.archived);
  return live.sort((a, b) => a.name.localeCompare(b.name));
}

let counter = 0;
const newId = () =>
  `e${Date.now().toString(36)}${(counter = (counter + 1) % 1e4).toString(36).padStart(3, "0")}`;

/* Add somebody.

   A name, a job, and where they work. Nothing is issued and there is nothing
   to hand over — their name appearing on the clock-in page is what lets them
   start recording shifts. */
export async function addEmployee(orgId, { name, title, branchId }) {
  const clean = String(name || "").trim().slice(0, 80);
  if (!clean) return { error: "name" };

  const map = (await getJSON(ROSTER(orgId))) || {};
  const rows = Object.values(map);

  if (rows.some((e) => !e.archived && e.name.trim().toLowerCase() === clean.toLowerCase())) {
    return { error: "duplicate" };
  }

  const record = {
    id: newId(),
    name: clean,
    title: String(title || "").trim().slice(0, 60),
    /* Where they work, when the org has more than one place. Null means "any",
       which is the right answer for a floater and for a single-site business
       that should not be asked the question at all. */
    branchId: String(branchId || "").trim() || null,
    archived: false,
    createdAt: Date.now(),
  };

  map[record.id] = record;
  await setJSON(ROSTER(orgId), map);
  return { employee: record };
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

/* One person, by id, whether they still work here or not.

   The clock-in page resolves a chosen name back to a record and has to tell
   "no such person" apart from "somebody who has left" — the caller decides
   which of the two it is willing to admit to. */
export async function getEmployee(orgId, id) {
  const map = (await getJSON(ROSTER(orgId))) || {};
  return map[String(id)] || null;
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
export async function punch(orgId, {
  employeeId, branchId, at = Date.now(), actor = "", source = "pad", photo = false,
}) {
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
    /* Which signed-in account recorded this, when one did. Not who worked the
       shift — that is `employeeId` — but who is answerable for the row, which
       is the thing a disputed punch turns on.

       Empty for a punch made from the clock-in page, where by design there is
       no session: `source` says so, and the photograph is what makes that one
       answerable instead. */
    actor: String(actor || "").slice(0, 80),
    /* "web" — puremargin.ae, on the arriving person's own phone, with a
       photograph of the place attached.
       "pad"  — recorded inside the app by a manager, for somebody who forgot.

       Recorded because the two are worth different amounts as evidence, and a
       manager reading a row deserves to know which one they are looking at. */
    source: source === "web" ? "web" : "pad",
    /* Whether a picture was taken with it. Kept on the punch rather than
       inferred from whether the photo key still resolves, so a row whose
       photograph the owner has since deleted says exactly that instead of
       looking like a punch that never had one. */
    photo: Boolean(photo),
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
