import { useState, useEffect } from "react";
import { ChefHat, Loader2, Check, AlertTriangle, Trash2 } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";
import PhotoScan from "./PhotoScan.jsx";

/* A recipe card, photographed.

   Typing recipes in is the largest piece of setup this product asks for, and
   it is the piece that stops people finishing: a business with no recipes gets
   no costs, no leakage and no depletion, which is most of what they paid for.
   The cards already exist — laminated by the pass, or in a notebook — so the
   fastest path from nothing to a costed menu is a photograph.

   Two things the card cannot tell us, and neither is guessed:

   Portions. A card that does not say how many it serves defaults to one, which
   makes the quantities per-portion — usually what such a card means. The
   screen says the assumption was made rather than hiding it, because getting
   it wrong scales every cost on the dish by the same factor.

   Yield. Trim and cooking loss are not written on a card and cannot be seen in
   a photograph, so it stays at 100 — as written — and somebody who knows the
   dish sets it afterwards. */

export default function RecipeScan({ token, onSaved, initial, onInitialUsed }) {
  const C = useC();
  const { t } = useLang();
  const s = t.recipescan;

  const [result, setResult] = useState(null);
  const [lines, setLines] = useState([]);
  const [stock, setStock] = useState([]);
  const [name, setName] = useState("");
  const [portions, setPortions] = useState(1);
  const [yieldPct, setYieldPct] = useState(100);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState(false);

  /* Arrives already read when the card was dropped into Ask rather than
     photographed here. */
  useEffect(() => {
    if (!initial) return;
    receive(initial);
    onInitialUsed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  useEffect(() => {
    fetch("/api/inventory", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setStock(j?.ingredients || []))
      .catch(() => {});
  }, [token]);

  const receive = (r) => {
    setResult(r);
    setDone(false);
    setNote("");
    setName(r?.menuItem || "");
    setPortions(r?.portions || 1);
    setYieldPct(r?.yieldPct ?? 100);
    setLines((r?.lines || []).map((l) => ({ ...l })));
  };

  const edit = (i, patch) => setLines((l) => l.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const drop = (i) => setLines((l) => l.filter((_, n) => n !== i));

  const ready = lines.filter((l) => l.ingredientId && l.qty > 0 && l.unit);
  /* Lines the store has nothing for. On a new account that is every one of
     them, which is exactly when being sent to a form is most discouraging, so
     they are created by the same press that saves the recipe. */
  const toCreate = lines.filter((l) => !l.ingredientId && l.newItem && l.qty > 0);

  const save = async () => {
    if (!name.trim()) { setFailed(true); setNote(s.errName); return; }
    setBusy(true); setNote("");
    try {
      let live = lines;

      if (toCreate.length) {
        const made = await fetch("/api/inventory?what=ingredients", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            source: "recipe-scan",
            ingredients: toCreate.map((l) => ({
              name: l.newItem.name,
              stockUnit: l.newItem.stockUnit,
              purchaseUnit: l.newItem.purchaseUnit,
              packSize: l.newItem.packSize,
              category: l.newItem.category || undefined,
            })),
          }),
        }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

        if (made?.ingredients?.length) {
          setStock((prev) => [...prev, ...made.ingredients]);
          live = lines.map((l) => {
            if (l.ingredientId || !l.newItem) return l;
            const hit = made.ingredients.find(
              (m) => m.name.toLowerCase() === l.newItem.name.toLowerCase());
            return hit ? { ...l, ingredientId: hit.id, stockUnit: hit.stockUnit } : l;
          });
          setLines(live);
        }
      }

      const saving = live.filter((l) => l.ingredientId && l.qty > 0 && l.unit);
      if (!saving.length) { setFailed(true); setNote(s.errLines); return; }

      const res = await fetch("/api/recipes?what=save", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          menuItem: name.trim(),
          portions: Number(portions) || 1,
          yieldPct: Number(yieldPct) || 100,
          note: result?.note || s.source,
          lines: saving.map((l) => ({ ingredientId: l.ingredientId, qty: Number(l.qty), unit: l.unit })),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setFailed(true);
        setNote(json.error === "unit" ? s.errUnit : json.error === "lines" ? s.errLines : s.errServer);
        return;
      }
      setFailed(false);
      setDone(true);
      setNote(fill(s.done, { name: name.trim(), count: saving.length }));
      onSaved?.(json.recipe);
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
        <ChefHat size={15} style={{ color: C.iris }} /> {s.title}
      </h3>
      <p className="text-xs mb-3" style={{ color: C.slate }}>{s.lead}</p>

      <PhotoScan token={token} kind="recipe" buttonLabel={s.scan} onResult={receive} />

      {result && (
        <div className="mt-4">
          <div className="flex flex-wrap gap-3 mb-3">
            <div className="flex-1 min-w-[10rem]">
              <label htmlFor="rname" className="block text-[11px] font-bold uppercase tracking-wide mb-1"
                style={{ color: C.slate }}>{s.dish}</label>
              <input id="rname" value={name} onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg px-2.5 py-1.5 text-sm outline-none"
                style={{ background: C.bone, border: `1px solid ${C.hairline}`, color: C.ink }} />
            </div>
            <div>
              <label htmlFor="rport" className="block text-[11px] font-bold uppercase tracking-wide mb-1"
                style={{ color: C.slate }}>{s.portions}</label>
              <input id="rport" type="number" min="1" step="1" dir="ltr"
                value={portions} onChange={(e) => setPortions(e.target.value)}
                {...field} style={{ ...field.style, width: "5rem", textAlign: "end" }} />
            </div>
            <div>
              <label htmlFor="ryield" className="block text-[11px] font-bold uppercase tracking-wide mb-1"
                style={{ color: C.slate }}>{s.yieldPct}</label>
              <input id="ryield" type="number" min="1" max="100" step="1" dir="ltr"
                value={yieldPct} onChange={(e) => setYieldPct(e.target.value)}
                {...field} style={{ ...field.style, width: "5rem", textAlign: "end" }} />
            </div>
          </div>

          {!result.portionsStated && (
            <p className="text-[11px] mb-3 flex items-start gap-1.5" style={{ color: C.rose }}>
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              {s.portionsGuessed}
            </p>
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
                      style={{ color: l.ingredientId ? C.ink : C.rose }}>
                      <option value="">{s.noMatch}</option>
                      {stock.map((ing) => <option key={ing.id} value={ing.id}>{ing.name}</option>)}
                    </select>
                    <div className="text-[11px] truncate" style={{ color: C.slate }}>{l.text}</div>
                  </div>

                  <input type="number" min="0" step="any" inputMode="decimal" dir="ltr"
                    value={l.qty ?? ""} onChange={(e) => edit(i, { qty: e.target.value })}
                    aria-label={s.qty} {...field} style={{ ...field.style, width: "4.5rem", textAlign: "end" }} />

                  <input value={l.unit || ""} onChange={(e) => edit(i, { unit: e.target.value })}
                    aria-label={s.unit} dir="ltr"
                    {...field} style={{ ...field.style, width: "3.5rem" }} />

                  <button type="button" onClick={() => drop(i)} aria-label={s.remove}
                    className="shrink-0 p-1 rounded" style={{ color: C.slate }}>
                    <Trash2 size={13} />
                  </button>

                  {mismatch && (
                    <p className="w-full text-[11px] flex items-center gap-1" style={{ color: C.rose }}>
                      <AlertTriangle size={11} />
                      {fill(s.unitMismatch, { card: l.unit, stock: l.stockUnit })}
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
            <button type="button" onClick={save} disabled={busy || !ready.length || !name.trim()}
              className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold disabled:opacity-50"
              style={{ background: C.iris, color: C.onPrimary }}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <ChefHat size={14} />}
              {busy ? s.saving : fill(s.save, { count: ready.length + toCreate.length })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
