/* What the kitchen has been sent, printer by printer.

   A ticket used to remember one number per line: how much of it "the
   kitchen" had been sent. With one printer that is the truth. With a hot
   line and a cold line it is not: the grill's printer taking the order while
   the salad station's is out of paper left the whole order marked as sent,
   and the salad was never made. And because the number was written before
   anyone knew whether the print had worked, a printer that was switched off
   swallowed orders silently.

   So a ticket now keeps two things:

     printedOn   { [printerKey]: { [lineKey]: qty } }   what each printer has
                 actually printed — written only for a print that succeeded
     printed     { [lineKey]: qty }                     what every printer on
                 this till that makes the line has printed; kept because an
                 older till, or one with different printers, reads only this

   A printer's key is its address when it is on the network — the same
   printer seen from two tills is one printer — and this till's own id for it
   otherwise.

   All arithmetic, no printing: it is the part that has to be right, so it is
   the part that can be tested without a printer. */

import { shortHash } from "./PrintJobManager.js";

export const printerKey = (printer) => (printer?.connection === "network"
  ? `net:${String(printer.service || printer.host || "").trim().toLowerCase()}:${printer.service ? 0 : Number(printer.port) || 9100}`
  : `dev:${printer?.id || ""}`);

/* Does this printer make this line? No categories set means it makes everything. */
const takes = (printer, line) => !printer.categories?.length || printer.categories.includes(line.category);

/* How much of a line this printer has been sent. A printer the ticket has
   never heard of — another till's — goes by the shared count, so opening a
   ticket on a second till does not print the whole order again. */
export function sentTo(order, key, lineKey) {
  const mine = order?.printedOn?.[key];
  if (mine && lineKey in mine) return Number(mine[lineKey]) || 0;
  return Number(order?.printed?.[lineKey]) || 0;
}

/* The work to do: for each kitchen printer, the lines it still owes.

   `lines` is every line of the order, ready to print: { key, qty, name,
   category, note, addons }. An automatic send leaves out a printer whose
   auto-print is off; `manual` includes it. `whole` is a reprint: every line
   in full, whatever was sent before.

   → [{ printer, key, lines: [{ …line, qty, from }], added }] */
export function kitchenWork(order, lines, printers, { manual = false, whole = false } = {}) {
  const out = [];
  for (const printer of printers) {
    if (printer.role !== "kitchen") continue;
    if (!manual && printer.autoPrint === false) continue;
    const key = printerKey(printer);
    const owed = [];
    let before = 0;
    for (const line of lines) {
      if (!takes(printer, line)) continue;
      const from = whole ? 0 : Math.min(line.qty, sentTo(order, key, line.key));
      before += from;
      if (line.qty - from > 0) owed.push({ ...line, qty: line.qty - from, from });
    }
    if (owed.length) out.push({ printer, key, lines: owed, added: before > 0 && !whole });
  }
  return out;
}

/* The job id for one printer's share. It names the lines *and how much of
   each had been sent before*, so asking twice for the same addition is the
   same job (a retry), and adding one more of a dish later is a new one.
   `whole` and `again` are stamps for a print somebody asked for by hand — a
   reprint, or a second go at one that may already be on paper — which is a
   new job every time it is asked for. */
export function kitchenJobId(work, { whole = "", again = "" } = {}) {
  const spec = work.lines.map((l) => `${l.key}:${l.from}+${l.qty}`).join("|");
  return `k-${shortHash(work.key)}-${shortHash(spec)}${whole ? `-w${whole}` : ""}${again ? `-${again}` : ""}`;
}

/* The ticket's record after a round of printing. Only what printed moves.

   `results` is one per piece of work, in order: { ok }. A reprint (`whole`)
   changes nothing: the kitchen already had those lines. */
export function applyKitchenResults(order, lines, printers, work, results) {
  const printedOn = Object.fromEntries(Object.entries(order?.printedOn || {}).map(([k, v]) => [k, { ...v }]));
  work.forEach((w, i) => {
    if (!results[i]?.ok) return;
    const mine = printedOn[w.key] || (printedOn[w.key] = {});
    for (const l of w.lines) mine[l.key] = l.from + l.qty;
  });
  const next = { ...order, printedOn };
  const auto = printers.filter((p) => p.role === "kitchen" && p.autoPrint !== false);
  const printed = { ...(order?.printed || {}) };
  for (const line of lines) {
    const makers = auto.filter((p) => takes(p, line));
    if (!makers.length) continue;
    const least = Math.min(...makers.map((p) => sentTo(next, printerKey(p), line.key)));
    if (least > 0) printed[line.key] = Math.max(Number(printed[line.key]) || 0, least);
  }
  return { printed, printedOn };
}
