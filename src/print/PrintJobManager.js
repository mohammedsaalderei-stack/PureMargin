/* PrintJobManager: one print job, one way, whatever is being printed.

   A receipt, a kitchen order, a shift report, a test page and a drawer pulse
   are the same thing by the time they get here:

     { id, kind, printer, sheet, drawer, copies }

       id       names this print on this printer. Asking again under the same
                id is a retry; the manager and the queue both use it to make
                sure a retry of something that did print does not print twice.
       kind     "receipt" | "kitchen" | "shift" | "test" | "drawer"
       printer  the printer's settings as they stood when the job was made
       sheet    what to print, already drawn: { parts: [{ image(), url() }] }.
                Absent for a drawer pulse.
       drawer   pulse the cash drawer with this job
       copies   how many

   The manager decides nothing about what a receipt looks like and knows
   nothing about sockets. It asks the printer's adapter what the connection
   can do, builds bytes or hands over the picture accordingly, and keeps
   three things straight that used to be nobody's job:

     · a job that failed is reported as failed, with a reason, to whoever
       asked — nothing is assumed to have printed;
     · each printer's last outcome is kept on its own, so one printer being
       out of paper is that printer's news;
     · a job that succeeded is not sent again under the same id.

   No DOM and no Capacitor in here, on purpose: it runs under test as it runs
   in the till. */

import { job as escposJob, drawerOnly, concat } from "./escpos.js";
import { profileOf } from "./profiles.js";

export class PrintError extends Error {
  constructor(code, detail = "", extra = {}) {
    super(detail || code);
    this.name = "PrintError";
    this.code = code;
    this.detail = detail;
    Object.assign(this, extra);
  }
}

/* Failures where the paper may have come out anyway. Everything else is a
   failure before or during sending, which a retry can simply repeat. */
export const UNCERTAIN = ["unconfirmed"];

export function createJobManager({ adapterFor, now = () => Date.now(), keep = 200, onChange = null } = {}) {
  const succeeded = new Map();
  const running = new Map();
  const failedOnce = new Set();
  const statuses = new Map();
  const listeners = new Set();

  const note = (printer, patch) => {
    const next = { printerId: printer.id, at: now(), ...patch };
    statuses.set(printer.id, next);
    for (const fn of listeners) { try { fn(printer.id, next); } catch { /* a listener's problem */ } }
    if (onChange) onChange(Object.fromEntries(statuses));
  };

  /* What this job may ask of this printer. A drawer is only ever opened by a
     connection that can carry the command, a printer that has one plugged
     in, and a job that wanted it — all three. */
  function plan(jobIn, caps) {
    const profile = profileOf(jobIn.printer);
    return {
      drawer: Boolean(jobIn.drawer && caps.drawer && profile.drawer && jobIn.printer.drawer !== false),
      cut: caps.cut && jobIn.printer.cut !== false ? profile.cut : null,
      status: Boolean(profile.status),
      copies: Math.max(1, Math.min(3, Number(jobIn.copies ?? jobIn.printer.copies) || 1)),
    };
  }

  async function run(jobIn) {
    const { printer } = jobIn;
    const adapter = adapterFor(printer);
    if (!adapter) throw new PrintError("noadapter");
    const caps = adapter.capabilities(printer);
    const p = plan(jobIn, caps);
    const payload = { id: jobIn.id, kind: jobIn.kind, retry: failedOnce.has(jobIn.id), status: p.status, paper: printer.paper || 80 };

    if (jobIn.kind === "drawer") {
      if (!caps.raw || !caps.drawer || !profileOf(printer).drawer) throw new PrintError("nodrawer");
      return adapter.send(printer, { ...payload, bytes: drawerOnly(printer.drawerPin) });
    }
    if (!jobIn.sheet?.parts?.length) throw new PrintError("empty");
    if (caps.raw) {
      const images = jobIn.sheet.parts.map((part) => part.image());
      const copies = [];
      for (let c = 0; c < p.copies; c += 1) {
        copies.push(escposJob(images, { drawer: p.drawer && c === 0, cut: p.cut, drawerPin: printer.drawerPin }));
      }
      return adapter.send(printer, { ...payload, bytes: copies.length === 1 ? copies[0] : concat(copies) });
    }
    return adapter.send(printer, { ...payload, pictures: jobIn.sheet.parts.map((part) => part.url()) });
  }

  /* Print a job. Never throws: the answer says what happened.
       { ok, jobId, printerId, state, confirmed, error, detail, uncertain, duplicate }
     state "printed"  the printer itself reported ready before and after
           "sent"     every byte reached the printer; it does not report back
           "dialog"   handed to the system's print dialog; a person finishes it */
  function submit(jobIn) {
    const base = { jobId: jobIn.id, printerId: jobIn.printer?.id, kind: jobIn.kind };
    if (succeeded.has(jobIn.id)) return Promise.resolve({ ...succeeded.get(jobIn.id), duplicate: true });
    if (running.has(jobIn.id)) return running.get(jobIn.id);
    note(jobIn.printer, { state: "printing", jobId: jobIn.id, kind: jobIn.kind });
    const work = run(jobIn).then((out) => {
      const result = { ...base, ok: true, state: out?.state || "sent", confirmed: Boolean(out?.confirmed), printer: out?.printer || null };
      succeeded.set(jobIn.id, result);
      if (succeeded.size > keep) succeeded.delete(succeeded.keys().next().value);
      failedOnce.delete(jobIn.id);
      note(jobIn.printer, { state: "ok", jobId: jobIn.id, kind: jobIn.kind, confirmed: result.confirmed, how: result.state, printer: result.printer });
      return result;
    }, (err) => {
      const code = err instanceof PrintError ? err.code : "failed";
      const detail = err instanceof PrintError ? err.detail : String(err?.message || err);
      failedOnce.add(jobIn.id);
      const result = { ...base, ok: false, state: "failed", error: code, detail, uncertain: UNCERTAIN.includes(code), printer: err?.printer || null };
      note(jobIn.printer, { state: "error", jobId: jobIn.id, kind: jobIn.kind, error: code, detail, printer: result.printer });
      return result;
    }).finally(() => { running.delete(jobIn.id); });
    running.set(jobIn.id, work);
    return work;
  }

  return {
    submit,
    /* Somebody looked at the printer and the paper is there: an uncertain
       job is put down as done, so nothing prints it again. */
    settle(jobIn) {
      const result = { jobId: jobIn.id, printerId: jobIn.printer?.id, kind: jobIn.kind, ok: true, state: "sent", confirmed: false, byHand: true };
      succeeded.set(jobIn.id, result);
      failedOnce.delete(jobIn.id);
      note(jobIn.printer, { state: "ok", jobId: jobIn.id, kind: jobIn.kind, confirmed: false, how: "sent" });
      return result;
    },
    statusOf: (printerId) => statuses.get(printerId) || null,
    restore(saved) { for (const [id, s] of Object.entries(saved || {})) if (s && s.state !== "printing") statuses.set(id, s); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

/* A short, stable name for a string: the same text always gives the same
   answer, so a retry builds the same job id as the attempt it repeats. */
export function shortHash(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  const s = String(text);
  for (let i = 0; i < s.length; i += 1) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
