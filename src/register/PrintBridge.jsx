/* Setting up the print bridge.

   The bridge is the piece a browser needs to reach a network printer: a
   program on a computer in the shop (`public/bridge/print-bridge.mjs`). This
   sheet says what it is and what it needs, makes one, and shows the single
   command that starts it — with its token, which is shown here once and
   nowhere else. After that it shows whether each bridge is answering, which
   is the first thing to look at when nothing prints. */

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Copy, Check, Download } from "lucide-react";
import { useC } from "../theme.jsx";
import { Btn, Sheet, Field } from "./ui.jsx";
import { printBridge } from "../print/printers.js";
import { printReason } from "./printText.js";

const SCRIPT = "/bridge/print-bridge.mjs";

function Command({ text, S }) {
  const C = useC();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* select it by hand */ }
  };
  return (
    <div className="rounded-xl p-3 mb-2 flex items-start gap-2" style={{ background: C.ink, color: C.surface }}>
      <code className="text-xs break-all flex-1 select-all" dir="ltr">{text}</code>
      <button onClick={copy} aria-label={S.copy} className="shrink-0 p-1.5 rounded-lg" style={{ background: "rgba(255,255,255,0.12)" }}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

export default function PrintBridge({ P, onClose }) {
  const C = useC();
  const S = P.settings.printers.bridge;
  const [setup, setSetup] = useState(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [made, setMade] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setSetup(await printBridge.setup()); setError(""); }
    catch (err) { setError(printReason(P, err?.code)); }
  }, [P]);
  /* Polled, so that "Running" appears by itself once the command is run. */
  useEffect(() => { load(); const id = setInterval(load, 4000); return () => clearInterval(id); }, [load]);

  const add = async () => {
    setBusy(true);
    try { setMade(await printBridge.addBridge(name)); setName(""); await load(); }
    catch (err) { setError(err?.code === "forbidden" ? S.managerOnly : printReason(P, err?.code)); }
    finally { setBusy(false); }
  };
  const remove = async (b) => {
    if (!window.confirm(S.removeConfirm)) return;
    try { await printBridge.removeBridge(b.id); if (made?.bridge.id === b.id) setMade(null); await load(); }
    catch (err) { setError(err?.code === "forbidden" ? S.managerOnly : printReason(P, err?.code)); }
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return (
    <Sheet title={S.title} onClose={onClose} wide>
      <p className="text-sm mb-2" style={{ color: C.slate }}>{S.what}</p>
      <p className="text-sm mb-4" style={{ color: C.slate }}>{S.needs}</p>
      {error && <p className="text-sm mb-3 font-semibold" style={{ color: C.rose }}>{error}</p>}

      {setup && !setup.bridges.length && !made && <p className="text-sm mb-3" style={{ color: C.slate }}>{S.none}</p>}
      {setup?.bridges.map((b) => (
        <div key={b.id} className="flex items-center justify-between gap-3 px-4 py-3 rounded-2xl mb-2" style={{ background: "var(--chip-bg)" }}>
          <span className="min-w-0">
            <span className="block text-sm font-bold truncate">{b.name}{b.machine ? <span className="font-normal" style={{ color: C.slate }}> · {b.machine}</span> : null}</span>
            <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: b.online ? C.mint : C.slate }}>
              <span className="w-2 h-2 rounded-full" style={{ background: b.online ? C.mint : C.slate }} />
              {b.online ? S.online : b.lastSeenAt ? S.offline : S.never}
            </span>
          </span>
          {setup.canManage && <button onClick={() => remove(b)} aria-label={S.remove} className="p-2 rounded-xl" style={{ color: C.rose }}><Trash2 size={16} /></button>}
        </div>
      ))}

      {made && (
        <div className="rounded-2xl p-4 my-3" style={{ border: `1px solid ${C.hairline}` }}>
          <p className="text-sm font-bold mb-2">{S.step1}</p>
          <a href={SCRIPT} download className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-sm font-semibold mb-3" style={{ background: "var(--chip-bg)", color: C.ink }}>
            <Download size={15} />{S.download}
          </a>
          <p className="text-sm font-bold mb-2">{S.step2}</p>
          <Command S={S} text={`node print-bridge.mjs --server ${origin} --token ${made.token}`} />
          <p className="text-xs mb-3" style={{ color: C.amber }}>{S.tokenOnce}</p>
          <p className="text-sm font-bold mb-3">{S.step3}</p>
          <p className="text-xs mb-1.5" style={{ color: C.slate }}>{S.probeTip}</p>
          <Command S={S} text="node print-bridge.mjs --probe 192.168.1.50" />
        </div>
      )}

      {setup?.canManage ? (
        <div className="mt-3">
          <Field label={S.name} value={name} onChange={setName} placeholder={S.nameHint} />
          <Btn full onClick={add} disabled={busy}><Plus size={16} />{S.add}</Btn>
        </div>
      ) : setup && <p className="text-sm mt-3" style={{ color: C.slate }}>{S.managerOnly}</p>}
      <p className="text-xs mt-4" style={{ color: C.slate }}>{S.offlineNote}</p>
    </Sheet>
  );
}
