/* The kitchen did not get the order — or not all of it.

   A kitchen printer that fails is not a notice that fades after three
   seconds: the food does not get made. This sheet stays until somebody has
   dealt with it, says which printer and why, and offers what can actually be
   done about each one.

   A failure before or during sending is simply tried again. One where the
   job left and nothing came back is different — the paper may be there — so
   the person who can see the printer decides: it printed, or print it again.
   Until one of those, nothing is recorded as sent for that printer. */

import { Printer, AlertTriangle } from "lucide-react";
import { useC } from "../theme.jsx";
import { Btn, Sheet } from "./ui.jsx";
import { printReason } from "./printText.js";

export default function KitchenRetry({ P, held, busy, onRetry, onClose }) {
  const C = useC();
  const R = P.print.retry;
  const stamp = () => Date.now().toString(36);
  const sure = held.failures.filter((f) => !f.uncertain);
  return (
    <Sheet title={R.title} onClose={onClose}
      footer={<div className="flex gap-2">
        <Btn kind="ghost" onClick={onClose} disabled={busy}>{R.close}</Btn>
        {sure.length > 0 && <Btn full onClick={() => onRetry({})} disabled={busy}><Printer size={16} />{R.again}</Btn>}
      </div>}>
      <p className="text-sm mb-3" style={{ color: C.slate }}>{R.lead}</p>
      {held.failures.map((f) => (
        <div key={f.key} className="rounded-2xl p-4 mb-2" style={{ background: "var(--chip-bg)" }}>
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={18} className="shrink-0 mt-0.5" style={{ color: f.uncertain ? C.amber : C.rose }} />
            <div className="min-w-0">
              <div className="font-bold text-sm">{f.name || P.settings.printers.unnamed}</div>
              <div className="text-sm" style={{ color: C.slate }}>{f.uncertain ? R.maybe : printReason(P, f.error)}</div>
              <div className="text-xs mt-1.5" style={{ color: C.slate }}>
                {f.work.lines.map((l) => `${l.qty} × ${l.name}`).join(" · ")}
              </div>
            </div>
          </div>
          {f.uncertain && (
            <div className="flex gap-2 mt-3">
              <Btn kind="ghost" full disabled={busy} onClick={() => onRetry({ printedByHand: [f.key] })}>{R.printed}</Btn>
              <Btn full disabled={busy} onClick={() => onRetry({ again: { [f.key]: stamp() } })}>{R.reprint}</Btn>
            </div>
          )}
        </div>
      ))}
    </Sheet>
  );
}
