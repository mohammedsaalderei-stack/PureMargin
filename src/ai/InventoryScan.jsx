import { useState } from "react";
import { Sparkles, ChevronDown } from "lucide-react";
import PhotoScan from "./PhotoScan.jsx";
import { useC } from "../theme.jsx";
import { useLang } from "../i18n.jsx";

/* AI stock reading: photograph a shelf or a delivery and get a list of what
   the model can see, with honest quantity estimates. Suggestions, not ledger
   entries — the count workflow stays the source of truth; this just saves
   the typing that comes before it. */

export default function InventoryScan({ token }) {
  const C = useC();
  const { t } = useLang();
  const s = t.invscan;
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState(null);

  return (
    <div className="panel p-5 md:p-6">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2.5 text-start">
        <Sparkles size={16} style={{ color: C.iris }} />
        <div className="flex-1">
          <h3 className="display font-bold text-base">{s.title}</h3>
          <p className="text-xs mt-0.5" style={{ color: C.slate }}>{s.note}</p>
        </div>
        <ChevronDown size={16} style={{ color: C.slate, transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
      </button>

      {open && (
        <div className="mt-4">
          <PhotoScan token={token} kind="inventory" buttonLabel={s.scan} onResult={setResult} />

          {result && (
            <div className="mt-4">
              {result.summary && <p className="text-sm mb-3" style={{ color: C.ink }}>{result.summary}</p>}
              <div className="space-y-1.5">
                {(result.items || []).map((item, i) => (
                  <div key={i} className="flex items-center gap-3 py-2 px-3 rounded-lg text-sm"
                    style={{ background: "var(--chip-bg)" }}>
                    <span className="flex-1 font-medium min-w-0 truncate">{item.name}</span>
                    <span className="data text-xs shrink-0" dir="ltr">
                      {item.qty !== null && item.qty !== undefined ? `≈ ${item.qty} ${item.unit || ""}` : "?"}
                    </span>
                    {item.note && <span className="text-[11px] max-w-[40%] truncate" style={{ color: C.slate }}>{item.note}</span>}
                  </div>
                ))}
              </div>
              <p className="text-[11px] mt-3" style={{ color: C.slate }}>{s.caveat}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
