import { useState, useEffect } from "react";
import { Truck, Loader2, Check, AlertTriangle, Trash2 } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";
import PhotoScan from "./PhotoScan.jsx";

/* A delivery note, turned into stock.

   The kitchen already photographs the note to check it against what arrived.
   This reads the same photograph, matches each line to an ingredient the
   business already keeps, and offers to receive it — so a delivery becomes
   stock and a fresh unit cost without a purchase order being typed twice.

   Nothing is written until somebody presses the button, for the same reason
   the bill scanner does not write consumption: a `receive` moves the balance
   the leakage screen later treats as fact.

   Every field stays editable. The match is a guess made from a supplier's
   abbreviation — "TOMATO RED 5KG BOX" against a shelf labelled "Tomatoes" —
   and the one thing worse than leaving a line unmatched is matching it to the
   wrong ingredient and calling that done. */

export default function SupplierScan({ token, onReceived }) {
  const C = useC();
  const { t } = useLang();
  const s = t.supplierscan;

  const [result, setResult] = useState(null);
  const [lines, setLines] = useState([]);
  const [stock, setStock] = useState([]);
  /* Fetched here rather than taken as a prop: this component is dropped into
     the inventory screen, which does not otherwise need the branch list, and
     threading one through only for this would make the screen carry state it
     has no use for. */
  const [branches, setBranches] = useState([]);
  const [branch, setBranch] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!branch && branches.length) setBranch(branches[0].id);
  }, [branches, branch]);

  useEffect(() => {
    fetch("/api/inventory", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setStock(j?.ingredients || []))
      .catch(() => {});

    fetch("/api/scope", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setBranches(j?.branches || []))
      .catch(() => {});
  }, [token]);

  const receive = (r) => {
    setResult(r);
    setDone(false);
    setNote("");
    setLines((r?.lines || []).map((l) => ({ ...l })));
  };

  const edit = (i, patch) =>
    setLines((list) => list.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  const drop = (i) => setLines((list) => list.filter((_, n) => n !== i));

  const ready = lines.filter((l) => l.ingredientId && l.qty > 0);

  const commit = async () => {
    if (!branch) { setFailed(true); setNote(s.pickBranch); return; }
    setBusy(true); setNote("");
    try {
      const res = await fetch("/api/stock?what=receive-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          branchId: branch,
          note: [s.source, result?.supplier, result?.invoiceNo].filter(Boolean).join(" · "),
          movements: ready.map((l) => ({
            ingredientId: l.ingredientId,
            qty: Number(l.qty),
            unit: l.unit || l.stockUnit,
            unitCost: l.unitCost,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setFailed(true);
        setNote(json.error === "unit" ? s.errUnit : s.errServer);
        return;
      }
      setFailed(false);
      setDone(true);
      setNote(fill(s.done, { count: json.movements?.length || 0 }));
      onReceived?.(json.movements || []);
    } catch {
      setFailed(true);
      setNote(s.errServer);
    } finally {
      setBusy(false);
    }
  };

  const field = {
    className: "data text-xs rounded px-1.5 py-1 outline-none",
    style: { background: C.surface, border: `1px solid ${C.hairline}`, color: C.ink },
  };

  return (
    <div className="panel p-5 md:p-6">
      <h3 className="display font-bold text-base mb-1 flex items-center gap-2">
        <Truck size={15} style={{ color: C.iris }} /> {s.title}
      </h3>
      <p className="text-xs mb-3" style={{ color: C.slate }}>{s.lead}</p>

      <PhotoScan token={token} kind="supplier" buttonLabel={s.scan} onResult={receive} />

      {result && (
        <div className="mt-4">
          <p className="text-xs mb-3" style={{ color: C.slate }}>
            {[result.supplier, result.invoiceNo, result.date].filter(Boolean).join(" · ") || s.noHeader}
          </p>

          {branches.length > 1 && (
            <div className="mb-3">
              <label htmlFor="supbranch" className="block text-[11px] font-bold uppercase tracking-wide mb-1"
                style={{ color: C.slate }}>{s.branch}</label>
              <select id="supbranch" value={branch} onChange={(e) => setBranch(e.target.value)}
                className="rounded-lg px-2.5 py-1.5 text-sm outline-none"
                style={{ background: C.bone, border: `1px solid ${C.hairline}`, color: C.ink }}>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}

          <div className="space-y-1.5">
            {lines.map((l, i) => {
              const mismatch = l.ingredientId && l.stockUnit && l.unit
                && l.unit.toLowerCase() !== l.stockUnit.toLowerCase();
              return (
                <div key={i} className="flex items-center gap-2 py-2 px-3 rounded-lg text-sm flex-wrap"
                  style={{ background: "var(--chip-bg)" }}>
                  <div className="flex-1 min-w-[9rem]">
                    <select
                      value={l.ingredientId || ""}
                      onChange={(e) => {
                        const ing = stock.find((x) => x.id === e.target.value);
                        edit(i, { ingredientId: e.target.value || null, stockUnit: ing?.stockUnit || null });
                      }}
                      aria-label={s.ingredient}
                      className="w-full bg-transparent font-medium outline-none text-sm"
                      style={{ color: l.ingredientId ? C.ink : C.rose }}
                    >
                      <option value="">{s.noMatch}</option>
                      {stock.map((ing) => (
                        <option key={ing.id} value={ing.id}>{ing.name}</option>
                      ))}
                    </select>
                    <div className="text-[11px] truncate" style={{ color: C.slate }}>{l.text}</div>
                  </div>

                  <input type="number" min="0" step="any" inputMode="decimal" dir="ltr"
                    value={l.qty ?? ""} onChange={(e) => edit(i, { qty: e.target.value })}
                    aria-label={s.qty} {...field} style={{ ...field.style, width: "4.5rem", textAlign: "end" }} />

                  <input value={l.unit || ""} onChange={(e) => edit(i, { unit: e.target.value })}
                    aria-label={s.unit} {...field} style={{ ...field.style, width: "3.5rem" }} dir="ltr" />

                  <input type="number" min="0" step="any" inputMode="decimal" dir="ltr"
                    value={l.unitCost ?? ""} onChange={(e) => edit(i, { unitCost: Number(e.target.value) })}
                    aria-label={s.unitCost} {...field} style={{ ...field.style, width: "5rem", textAlign: "end" }} />

                  <button type="button" onClick={() => drop(i)} aria-label={s.remove}
                    className="shrink-0 p-1 rounded" style={{ color: C.slate }}>
                    <Trash2 size={13} />
                  </button>

                  {mismatch && (
                    <p className="w-full text-[11px] flex items-center gap-1" style={{ color: C.rose }}>
                      <AlertTriangle size={11} />
                      {fill(s.unitMismatch, { invoice: l.unit, stock: l.stockUnit })}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <p className="text-[11px] mt-2" style={{ color: C.slate }}>{s.editHint}</p>

          {note && (
            <p className="text-xs mt-3 flex items-center gap-1" style={{ color: failed ? C.rose : C.cyan }}>
              {!failed && <Check size={13} />} {note}
            </p>
          )}

          {!done && (
            <button type="button" onClick={commit} disabled={busy || !ready.length}
              className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold disabled:opacity-50"
              style={{ background: C.iris, color: C.onPrimary }}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Truck size={14} />}
              {busy ? s.saving : fill(s.commit, { count: ready.length })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
