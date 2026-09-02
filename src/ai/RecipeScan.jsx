import { useState, useEffect } from "react";
import { ChefHat, Loader2, Check, AlertTriangle, Trash2, Plus, Save, X } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";
import PhotoScan from "./PhotoScan.jsx";

/* A recipe card, photographed, and the screen that reviews it.

   ── Why this is the way in ───────────────────────────────────────────────

   Typing recipes in is the largest piece of setup this product asks for, and
   it is the piece that stops people finishing: a business with no recipes gets
   no costs, no leakage and no depletion, which is most of what they paid for.
   The cards already exist — laminated by the pass, or in a notebook — so the
   fastest path from nothing to a costed menu is a photograph.

   ── One press, and no inventory first ────────────────────────────────────

   This used to be two calls. Create every ingredient the card named that the
   store did not have, wait, re-attach the new ids onto the lines, then save
   the recipe. If the first failed the screen was left holding a card it could
   not save; if the second failed the store had gained nine ingredients for a
   recipe that did not exist.

   Both are gone, because the recipe endpoint now creates what it needs. A line
   is a name, a quantity and a unit — if the name resolves to nothing, the
   ingredient is created from exactly those three things. So the payload is the
   recipe, the call is one call, and a card can be saved by somebody whose
   inventory is empty. Which is everybody, on their first day.

   ── What this screen does not ask ────────────────────────────────────────

   No yield. Trim and cooking loss are not written on a card and cannot be seen
   in a photograph, and a required field produced a number people invented to
   get past it. No "what changed" note — a card being read has no previous
   version to have changed from. No cost-basis toggle: that is a question about
   how to value stock, not about what is in the dish.

   Nothing here blocks on the item master. A line naming something the store
   has never heard of is not a warning; on day one it is every line. */

const emptyLine = { text: "", qty: "", unit: "" };

export default function RecipeScan({ token, onSaved, initial, onInitialUsed }) {
  const C = useC();
  const { t } = useLang();
  const s = t.recipescan;

  /* The draft, as one object rather than eight useStates. Every field is
     filled from the same scan at the same moment, and resetting them
     individually is how one gets forgotten and carries into the next card. */
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [failed, setFailed] = useState(false);

  /* Arrives already read when the card was dropped into Ask rather than
     photographed here. */
  useEffect(() => {
    if (!initial) return;
    open(initial);
    onInitialUsed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  /* A parsed card becomes a draft. Each line keeps the name the card used —
     that string is what the recipe endpoint resolves or creates against, so
     what somebody reads on screen is what gets saved. */
  const open = (r) => {
    const rows = (list) => (list || []).map((l) => ({
      text: l.ingredientName || l.text || "",
      qty: l.qty ?? "",
      unit: l.unit || l.stockUnit || "",
    }));
    setDraft({
      menuItem: r?.menuItem || "",
      category: r?.category || "",
      sellPrice: r?.sellPrice ?? "",
      /* Read off the card where it said so, one where it did not — which makes
         the quantities per portion, what a card without a batch line means. */
      portions: r?.portions || 1,
      portionsStated: Boolean(r?.portionsStated),
      lines: rows(r?.lines).length ? rows(r.lines) : [{ ...emptyLine }],
      packaging: rows(r?.packaging),
    });
    setNote("");
    setFailed(false);
  };

  const cancel = () => { setDraft(null); setNote(""); setFailed(false); };

  const patch = (p) => setDraft((d) => ({ ...d, ...p }));
  const editRow = (key, i, p) => setDraft((d) => ({
    ...d, [key]: d[key].map((r, n) => (n === i ? { ...r, ...p } : r)),
  }));
  const dropRow = (key, i) => setDraft((d) => ({
    ...d, [key]: d[key].filter((_, n) => n !== i),
  }));
  const addRow = (key) => setDraft((d) => ({ ...d, [key]: [...d[key], { ...emptyLine }] }));

  /* A row counts once it has a name and a positive quantity. A blank unit is
     allowed: the endpoint falls back to grams and the item stays correctable,
     which beats refusing to save a card because one line said "a pinch". */
  const usable = (rows) => (rows || []).filter((r) => r.text.trim() && Number(r.qty) > 0);

  const save = async () => {
    const lines = usable(draft.lines);
    if (!draft.menuItem.trim()) { setFailed(true); setNote(s.errName); return; }
    if (!lines.length) { setFailed(true); setNote(s.errLines); return; }

    setBusy(true);
    setNote("");
    try {
      const asPayload = (rows) => rows.map((r) => ({
        name: r.text.trim(),
        qty: Number(r.qty),
        unit: r.unit.trim() || undefined,
      }));

      const res = await fetch("/api/recipes?what=save", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          menuItem: draft.menuItem.trim(),
          category: draft.category.trim() || undefined,
          sellPrice: Number(draft.sellPrice) > 0 ? Number(draft.sellPrice) : undefined,
          portions: Number(draft.portions) > 0 ? Number(draft.portions) : 1,
          lines: asPayload(lines),
          packaging: asPayload(usable(draft.packaging)),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFailed(true);
        setNote(json.error === "unit" ? s.errUnit
          : json.error === "duplicate" ? s.errDuplicate
            : s.errServer);
        return;
      }

      onSaved?.(json.recipe);
      setDraft(null);
      setFailed(false);
      setNote(fill(s.done, {
        name: draft.menuItem.trim(),
        count: lines.length + usable(draft.packaging).length,
      }));
    } catch {
      setFailed(true);
      setNote(s.errServer);
    } finally {
      setBusy(false);
    }
  };

  const field = {
    className: "rounded-lg px-2.5 py-2 text-sm outline-none w-full",
    style: { background: C.bone, border: `1px solid ${C.hairline}`, color: C.ink },
  };
  const small = {
    className: "data rounded-lg px-2 py-2 text-xs outline-none",
    style: { background: C.bone, border: `1px solid ${C.hairline}`, color: C.ink },
  };
  const label = (text) => (
    <div className="text-[11px] font-semibold mb-1.5" style={{ color: C.slate }}>{text}</div>
  );

  /* Both tables are the same three columns. Packaging differs in what it costs
     into, not in how it is typed. */
  const table = (key, addLabel) => (
    <div className="space-y-1.5">
      {draft[key].map((row, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            {...field}
            className={`${field.className} flex-1 min-w-0`}
            value={row.text}
            placeholder={s.ingredientPlaceholder}
            onChange={(e) => editRow(key, i, { text: e.target.value })}
          />
          <input
            {...small}
            type="number" min="0" step="any" inputMode="decimal" dir="ltr"
            style={{ ...small.style, width: "4rem", textAlign: "end" }}
            value={row.qty} placeholder={s.qty} aria-label={s.qty}
            onChange={(e) => editRow(key, i, { qty: e.target.value })}
          />
          <input
            {...small}
            dir="ltr"
            style={{ ...small.style, width: "3.25rem" }}
            value={row.unit} placeholder={s.unit} aria-label={s.unit}
            onChange={(e) => editRow(key, i, { unit: e.target.value })}
          />
          <button type="button" onClick={() => dropRow(key, i)} aria-label={s.remove}
            className="shrink-0 p-1.5 rounded-lg" style={{ color: C.slate }}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => addRow(key)}
        className="text-xs font-semibold inline-flex items-center gap-1 pt-1"
        style={{ color: C.iris }}>
        <Plus size={13} /> {addLabel}
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      <PhotoScan token={token} kind="recipe" buttonLabel={s.scan} onResult={open} />

      {note && !draft && (
        <p className="text-xs flex items-center gap-1.5 px-1"
          style={{ color: failed ? C.rose : C.mint }}>
          {failed ? <AlertTriangle size={13} /> : <Check size={13} />} {note}
        </p>
      )}

      {draft && (
        <div className="panel p-5 md:p-6 space-y-4">
          <h3 className="display font-bold text-base flex items-center gap-2">
            <span className="grid place-items-center w-7 h-7 rounded-lg shrink-0"
              style={{ background: "var(--chip-bg)" }}>
              <ChefHat size={14} style={{ color: C.iris }} />
            </span>
            {s.extracted}
          </h3>

          <div>
            {label(s.dish)}
            <input {...field} value={draft.menuItem} placeholder={s.dishPlaceholder}
              onChange={(e) => patch({ menuItem: e.target.value })} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              {label(s.category)}
              <input {...field} value={draft.category} placeholder={s.categoryPlaceholder}
                onChange={(e) => patch({ category: e.target.value })} />
            </div>
            <div>
              {label(s.sellPrice)}
              <input {...field} type="number" min="0" step="any" inputMode="decimal" dir="ltr"
                value={draft.sellPrice} placeholder="0.00"
                onChange={(e) => patch({ sellPrice: e.target.value })} />
            </div>
          </div>

          {/* Shown only when the card actually stated a batch size. A dish that
              makes one portion is the overwhelming case and needs no field; a
              card saying "serves 4" needs the number kept, because getting it
              wrong scales every cost on the dish by the same factor. */}
          {draft.portionsStated && Number(draft.portions) !== 1 && (
            <div>
              {label(s.portions)}
              <input {...field} type="number" min="1" step="any" dir="ltr"
                value={draft.portions}
                onChange={(e) => patch({ portions: e.target.value })} />
            </div>
          )}

          <div>
            {label(s.ingredients)}
            {table("lines", s.addLine)}
          </div>

          <div>
            {label(s.packaging)}
            {table("packaging", s.addPackaging)}
          </div>

          {note && (
            <p className="text-xs flex items-center gap-1.5"
              style={{ color: failed ? C.rose : C.mint }}>
              {failed ? <AlertTriangle size={13} /> : <Check size={13} />} {note}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3 pt-1">
            <button type="button" onClick={cancel} disabled={busy}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold disabled:opacity-50"
              style={{
                background: "color-mix(in srgb, var(--rose) 10%, transparent)",
                border: "1px solid color-mix(in srgb, var(--rose) 35%, transparent)",
                color: C.rose,
              }}>
              <X size={15} /> {s.cancel}
            </button>
            <button type="button" onClick={save} disabled={busy}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold disabled:opacity-50"
              style={{
                background: "color-mix(in srgb, var(--mint) 12%, transparent)",
                border: "1px solid color-mix(in srgb, var(--mint) 40%, transparent)",
                color: C.mint,
              }}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {busy ? s.saving : s.save}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
