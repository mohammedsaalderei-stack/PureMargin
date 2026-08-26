import { useState } from "react";
import { Sparkles, ChevronDown, Trash2 } from "lucide-react";
import PhotoScan from "./PhotoScan.jsx";
import NewIngredients from "./NewIngredients.jsx";
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

  /* The estimates are the model's guess from a photograph, and it says so —
     but a guess you cannot correct is worse than no guess, because the next
     step is a stock count and a wrong number carried into one is a number
     somebody has to find and undo later. Names, quantities and units are all
     editable, and a row that isn't really there can be dropped. */
  const [items, setItems] = useState([]);
  const edit = (i, patch) =>
    setItems((list) => list.map((it, n) => (n === i ? { ...it, ...patch } : it)));
  const drop = (i) => setItems((list) => list.filter((_, n) => n !== i));

  const receive = (r) => {
    setResult(r);
    setItems((r?.items || []).map((it) => ({ ...it })));
  };

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
          <PhotoScan token={token} kind="inventory" buttonLabel={s.scan} onResult={receive} />

          {result && (
            <div className="mt-4">
              {result.summary && <p className="text-sm mb-3" style={{ color: C.ink }}>{result.summary}</p>}
              <div className="space-y-1.5">
                {items.map((item, i) => (
                  <div key={i} className="flex items-center gap-2 py-2 px-3 rounded-lg text-sm"
                    style={{ background: "var(--chip-bg)" }}>
                    <input
                      value={item.name || ""}
                      onChange={(e) => edit(i, { name: e.target.value })}
                      aria-label={s.itemName}
                      className="flex-1 min-w-0 bg-transparent font-medium outline-none"
                      style={{ color: C.ink }}
                    />
                    <input
                      type="number" min="0" step="any" inputMode="decimal" dir="ltr"
                      value={item.qty ?? ""}
                      onChange={(e) => edit(i, { qty: e.target.value === "" ? null : Number(e.target.value) })}
                      aria-label={s.qty}
                      className="data text-xs shrink-0 w-16 text-end rounded px-1.5 py-1 outline-none"
                      style={{ background: C.surface, border: `1px solid ${C.hairline}`, color: C.ink }}
                    />
                    <input
                      value={item.unit || ""}
                      onChange={(e) => edit(i, { unit: e.target.value })}
                      aria-label={s.unit}
                      className="data text-xs shrink-0 w-14 rounded px-1.5 py-1 outline-none"
                      style={{ background: C.surface, border: `1px solid ${C.hairline}`, color: C.ink }}
                    />
                    <button
                      type="button" onClick={() => drop(i)} aria-label={s.remove}
                      className="shrink-0 p-1 rounded"
                      style={{ color: C.slate }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-[11px] mt-2" style={{ color: C.slate }}>{s.editHint}</p>

              {/* A shelf photographed before the master exists is the normal
                  first use, not an edge case. Everything read here can become
                  an ingredient without leaving the screen. */}
              <NewIngredients token={token} seeds={items} />
              <p className="text-[11px] mt-3" style={{ color: C.slate }}>{s.caveat}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
