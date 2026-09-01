import { useState } from "react";
import { Plus, X } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";

/* Writing a recipe version.

   Two things this form has to teach, because getting them wrong silently is
   expensive: quantities are stated **as they end up in the dish** and yield turns
   that into the draw on stock, and packaging is costed separately from food. Both
   are said in a sentence under the field rather than left for a support call.

   Saving always creates a new dated version — there is no edit — so the form is
   also the version editor, pre-filled from whatever is currently in force. */

const emptyLine = { ingredientId: "", name: "", qty: "", unit: "", estimatedCost: "" };

export default function RecipeForm({ meta, recipe, busy, error, onSave, onCancel }) {
  const C = useC();
  const { t } = useLang();
  const s = t.recipes;

  const current = recipe?.effective || null;
  const [head, setHead] = useState({
    menuItem: recipe?.menuItem || "",
    variant: recipe?.variant || "",
    category: recipe?.category || "",
    sellPrice: recipe?.sellPrice ?? "",
    portions: current?.portions ?? 1,
    yieldPct: current?.yieldPct ?? 100,
    note: "",
  });
  /* Existing lines are re-filled by name as well as id: the box a person edits
     shows a name, and a row that arrived with only an id would render blank
     and read as a line that had lost its ingredient. */
  const refill = (l) => ({
    ingredientId: l.ingredientId, name: l.name || "",
    qty: String(l.qty), unit: l.unit, estimatedCost: "",
  });
  const [lines, setLines] = useState(current?.lines?.map(refill) || [{ ...emptyLine }]);
  const [packaging, setPackaging] = useState(current?.packaging?.map(refill) || []);

  const items = meta.ingredients || [];
  const field = {
    className: "w-full px-2.5 py-2 rounded-lg text-sm",
    style: { background: C.bone, border: `1px solid ${C.hairline}`, color: C.ink },
  };
  /* A label, and under it what the field is for. Not what it is called — the
     label does that — and not how to fill it in. The test each hint has to
     pass: would somebody who has never costed a recipe know why this box
     exists and what it costs them to get it wrong? */
  const label = (text, hint) => (
    <>
      <span className="text-xs font-medium block" style={{ color: C.slate }}>{text}</span>
      {hint && (
        <span className="text-[11px] block mt-0.5 mb-1" style={{ color: C.slate, opacity: 0.85 }}>
          {hint}
        </span>
      )}
    </>
  );

  /* Match a typed name to something already on file, the way the server does —
     folded and punctuation-insensitive, so "Olive Oil" and "olive oil" are the
     same ingredient rather than two. */
  const findItem = (typed) => {
    const name = String(typed || "").trim().toLowerCase();
    if (!name) return null;
    return items.find((i) => i.name.trim().toLowerCase() === name) || null;
  };

  /* One editor for both lists — food and packaging differ in how they are costed,
     not in how they are typed.

     The ingredient used to be a `<select>` over what the store already held,
     which meant a recipe could only name things that had already been bought.
     A chef writing down a dish names what is in it, and half of those have
     never been through this system. Now it is a text box with the existing
     names as suggestions: pick one, or type a new one and it is created on
     save with the unit and estimate given here.

     The estimate appears only for a name that is not already on file, because
     for everything else the answer is better — it comes from what the last
     invoice actually charged, and a box inviting somebody to override that
     with a guess is a box that will be used. */
  const LineRows = ({ rows, setRows, addLabel, listId }) => (
    <>
      <datalist id={listId}>
        {items.map((i) => <option key={i.id} value={i.name} />)}
      </datalist>

      <div className="space-y-2">
        {rows.map((row, index) => {
          const known = findItem(row.name);
          const patch = (p) => setRows(rows.map((r, i) => (i === index ? { ...r, ...p } : r)));

          return (
            <div key={index} className="flex gap-2 items-start flex-wrap">
              <input {...field} className={`${field.className} flex-1 min-w-[8rem]`}
                list={listId} placeholder={s.chooseItem} value={row.name}
                onChange={(e) => {
                  const hit = findItem(e.target.value);
                  patch({
                    name: e.target.value,
                    ingredientId: hit?.id || "",
                    /* Adopting a known ingredient's unit, but never overwriting
                       one already typed — the recipe may legitimately call for
                       grams of something the shelf keeps in kilos. */
                    unit: row.unit || hit?.stockUnit || "",
                  });
                }} />

              <input {...field} className={`${field.className} w-20`} type="number" min="0" step="any" dir="ltr"
                placeholder={s.qty} value={row.qty}
                onChange={(e) => patch({ qty: e.target.value })} />

              <input {...field} className={`${field.className} w-16`} dir="ltr" placeholder={s.unit}
                value={row.unit} onChange={(e) => patch({ unit: e.target.value })} />

              {row.name.trim() && !known && (
                <input {...field} className={`${field.className} w-24`} type="number" min="0" step="any" dir="ltr"
                  placeholder={s.estCost} title={s.estCostHint} aria-label={s.estCost}
                  value={row.estimatedCost}
                  onChange={(e) => patch({ estimatedCost: e.target.value })} />
              )}

              <button type="button" onClick={() => setRows(rows.filter((_, i) => i !== index))}
                aria-label={s.removeLine}
                className="p-2 rounded-lg hover-soft shrink-0" style={{ color: C.slate }}>
                <X size={14} />
              </button>

              {row.name.trim() && !known && (
                <p className="w-full text-[11px]" style={{ color: C.iris }}>
                  {fill(s.willCreate, { name: row.name.trim() })}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <button type="button" onClick={() => setRows([...rows, { ...emptyLine }])}
        className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg"
        style={{ border: `1px solid ${C.hairline}`, color: C.slate }}>
        <Plus size={12} /> {addLabel}
      </button>
    </>
  );

  /* A line needs a name and a quantity; an id is optional, because a name with
     no id is exactly the new ingredient the server will create. The estimate
     is stated per the line's own unit — "22.80 a kilo" against a line in
     kilos — and converted to a per-base figure server-side. */
  const clean = (rows) => rows
    .filter((r) => String(r.name || "").trim() && r.qty !== "")
    .map((r) => ({
      ingredientId: r.ingredientId || undefined,
      name: String(r.name).trim(),
      qty: Number(r.qty),
      unit: r.unit || undefined,
      estimatedCost: r.estimatedCost === "" || r.estimatedCost === undefined
        ? undefined
        : Number(r.estimatedCost),
    }));

  const submit = (e) => {
    e.preventDefault();
    onSave({
      id: recipe?.id,
      ...head,
      sellPrice: head.sellPrice === "" ? null : Number(head.sellPrice),
      portions: Number(head.portions),
      yieldPct: Number(head.yieldPct),
      lines: clean(lines),
      packaging: clean(packaging),
    });
  };

  return (
    <form onSubmit={submit} className="panel p-5 md:p-6">
      <h3 className="display font-bold text-base mb-4">
        {recipe ? fill(s.editing, { name: recipe.menuItem }) : s.newRecipe}
      </h3>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          {label(s.menuItem)}
          <input {...field} className={`${field.className} mt-1`} value={head.menuItem} required
            /* The name identifies the recipe and its versions, so it is fixed
               once written — a rename would orphan the history. */
            disabled={Boolean(recipe)}
            onChange={(e) => setHead({ ...head, menuItem: e.target.value })} />
        </label>
        <label className="block">
          {label(s.variant)}
          <input {...field} className={`${field.className} mt-1`} value={head.variant}
            onChange={(e) => setHead({ ...head, variant: e.target.value })} />
        </label>
        <label className="block">
          {label(s.category, s.categoryHint)}
          <input {...field} className={`${field.className} mt-1`} value={head.category}
            onChange={(e) => setHead({ ...head, category: e.target.value })} />
        </label>
        <label className="block">
          {label(s.sellPrice, s.sellPriceHint)}
          <input {...field} className={`${field.className} mt-1`} type="number" min="0" step="any" dir="ltr"
            value={head.sellPrice} onChange={(e) => setHead({ ...head, sellPrice: e.target.value })} />
        </label>
        <label className="block">
          {label(s.portions, s.portionsHint)}
          <input {...field} className={`${field.className} mt-1`} type="number" min="1" step="any" dir="ltr"
            value={head.portions} onChange={(e) => setHead({ ...head, portions: e.target.value })} />
        </label>
        <label className="block">
          {label(s.yieldPct, s.yieldHint)}
          <input {...field} className={`${field.className} mt-1`} type="number" min="1" max="100" step="any" dir="ltr"
            value={head.yieldPct} onChange={(e) => setHead({ ...head, yieldPct: e.target.value })} />
        </label>
      </div>
      <p className="text-[11px] mt-2" style={{ color: C.slate }}>{s.yieldHint}</p>

      <div className="mt-5">
        <div className="text-xs font-semibold" style={{ color: C.slate }}>{s.ingredients}</div>
        <div className="text-[11px] mb-2" style={{ color: C.slate, opacity: 0.85 }}>{s.ingredientsHint}</div>
        <LineRows rows={lines} setRows={setLines} addLabel={s.addLine} listId="recipe-items" />
      </div>

      <div className="mt-5">
        <div className="text-xs font-semibold" style={{ color: C.slate }}>{s.packaging}</div>
        {/* This hint was rendered twice, once as a div and again as a p
            directly beneath it. */}
        <div className="text-[11px] mb-2" style={{ color: C.slate, opacity: 0.85 }}>{s.packagingHint}</div>
        <LineRows rows={packaging} setRows={setPackaging} addLabel={s.addPackaging} listId="recipe-packaging" />
      </div>

      <label className="block mt-5">
        {label(s.versionNote)}
        <input {...field} className={`${field.className} mt-1`} value={head.note}
          onChange={(e) => setHead({ ...head, note: e.target.value })} />
      </label>
      <p className="text-[11px] mt-2" style={{ color: C.slate }}>{s.effectiveHint}</p>

      {error && <p className="text-sm mt-3" style={{ color: C.rose }}>{error}</p>}

      <div className="flex flex-wrap gap-2 mt-5">
        <button type="submit" disabled={busy}
          className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-60"
          style={{ background: C.iris, color: C.onPrimary }}>
          {busy ? s.saving : s.save}
        </button>
        <button type="button" onClick={onCancel}
          className="px-4 py-2 rounded-lg text-sm font-semibold"
          style={{ border: `1px solid ${C.hairline}`, color: C.slate }}>
          {t.inventory.cancel}
        </button>
      </div>
    </form>
  );
}
