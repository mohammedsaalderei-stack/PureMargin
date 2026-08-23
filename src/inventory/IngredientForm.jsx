import { useState, useEffect } from "react";
import { useC } from "../theme.jsx";
import { useLang } from "../i18n.jsx";

/* Add or edit one ingredient.

   The two fields that matter most are the two people get wrong: the stock unit
   (what recipes will be written in) and the purchase pack (how it arrives). The
   form states the relationship between them in words as you fill it in — "1 kg =
   1000 g" — because a pack size entered against the wrong unit produces a food
   cost that is wrong by a factor of a thousand and looks perfectly ordinary.

   The unit picker only offers units in the same dimension as the stock unit, so
   an impossible conversion can't be submitted in the first place. The server
   validates the same rule regardless; this just means the user doesn't have to
   discover it from an error. */

const EMPTY = {
  name: "", category: "", stockUnit: "g", purchaseUnit: "kg", packSize: 1,
  sku: "", barcode: "", supplierId: "", location: "",
  reorderPoint: "", parLevel: "", shelfLifeDays: "",
};

function Field({ label, children, hint }) {
  const C = useC();
  return (
    <label className="block">
      <span className="text-xs font-medium" style={{ color: C.slate }}>{label}</span>
      {children}
      {hint && <span className="block text-[11px] mt-1" style={{ color: C.slate }}>{hint}</span>}
    </label>
  );
}

export default function IngredientForm({ editing, units, suppliers, meta, busy, error, onSave, onCancel }) {
  const C = useC();
  const { t } = useLang();
  const [form, setForm] = useState(EMPTY);

  useEffect(() => {
    setForm(editing ? { ...EMPTY, ...editing } : EMPTY);
  }, [editing]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const input = {
    className: "mt-1 w-full px-3 py-2 rounded-lg text-sm",
    style: { background: C.bone, border: `1px solid ${C.hairline}`, color: C.ink },
  };

  /* Which dimension we're in, and therefore which units may be offered. */
  const groups = units || { mass: [], volume: [], count: [] };
  const dimensionOf = (unit) =>
    ["mass", "volume", "count"].find((d) => (groups[d] || []).some((u) => u.key === unit)) || "mass";
  const dimension = dimensionOf(form.stockUnit);
  const sameDim = groups[dimension] || [];

  /* Keep the purchase unit inside the stock unit's dimension: changing "g" to
     "l" must not leave "kg" behind as a purchase unit the server will reject. */
  useEffect(() => {
    if (!sameDim.some((u) => u.key === form.purchaseUnit)) {
      setForm((f) => ({ ...f, purchaseUnit: f.stockUnit }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.stockUnit]);

  const packLine = (() => {
    const size = Number(form.packSize);
    if (!(size > 0) || !form.purchaseUnit || !form.stockUnit) return "";
    const pu = sameDim.find((u) => u.key === form.purchaseUnit)?.label || form.purchaseUnit;
    const su = sameDim.find((u) => u.key === form.stockUnit)?.label || form.stockUnit;
    return `${size} ${pu} — ${t.inventory.packMeans} ${su}`;
  })();

  const submit = (e) => {
    e.preventDefault();
    onSave({
      ...form,
      /* Blank optional numbers are absent, not zero: a reorder point of zero is
         a real instruction ("never reorder"), so it must not be what an empty
         box means. */
      packSize: Number(form.packSize) > 0 ? Number(form.packSize) : 1,
      reorderPoint: form.reorderPoint === "" ? null : Number(form.reorderPoint),
      parLevel: form.parLevel === "" ? null : Number(form.parLevel),
      shelfLifeDays: form.shelfLifeDays === "" ? null : Number(form.shelfLifeDays),
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
      <Field label={t.inventory.name}>
        <input {...input} value={form.name} onChange={set("name")} required
          disabled={Boolean(editing)}
          /* The id is derived from the name, so renaming would orphan the
             history that points at it. Archive and re-add instead. */
          placeholder={t.inventory.namePlaceholder} />
      </Field>

      <Field label={t.inventory.category}>
        <input {...input} value={form.category} onChange={set("category")} list="pm-categories" />
        <datalist id="pm-categories">
          {(meta?.categories || []).map((c) => <option key={c} value={c} />)}
        </datalist>
      </Field>

      <Field label={t.inventory.stockUnit} hint={t.inventory.stockUnitHint}>
        <select {...input} value={form.stockUnit} onChange={set("stockUnit")}>
          {["mass", "volume", "count"].map((d) => (
            <optgroup key={d} label={t.inventory.dimensions[d]}>
              {(groups[d] || []).map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
            </optgroup>
          ))}
        </select>
      </Field>

      <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
        <Field label={t.inventory.packSize} hint={packLine}>
          <input {...input} type="number" min="0" step="any" value={form.packSize} onChange={set("packSize")} dir="ltr" />
        </Field>
        <Field label={t.inventory.purchaseUnit}>
          <select {...input} value={form.purchaseUnit} onChange={set("purchaseUnit")}>
            {sameDim.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
          </select>
        </Field>
      </div>

      <Field label={t.inventory.supplier}>
        <select {...input} value={form.supplierId} onChange={set("supplierId")}>
          <option value="">{t.inventory.noSupplier}</option>
          {(suppliers || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Field>

      <Field label={t.inventory.location}>
        <input {...input} value={form.location} onChange={set("location")} list="pm-locations" />
        <datalist id="pm-locations">
          {(meta?.locations || []).map((l) => <option key={l} value={l} />)}
        </datalist>
      </Field>

      <Field label={t.inventory.sku}><input {...input} value={form.sku} onChange={set("sku")} dir="ltr" /></Field>
      <Field label={t.inventory.barcode}><input {...input} value={form.barcode} onChange={set("barcode")} dir="ltr" /></Field>

      <Field label={t.inventory.reorderPoint} hint={t.inventory.reorderHint}>
        <input {...input} type="number" min="0" step="any" value={form.reorderPoint ?? ""} onChange={set("reorderPoint")} dir="ltr" />
      </Field>
      <Field label={t.inventory.parLevel}>
        <input {...input} type="number" min="0" step="any" value={form.parLevel ?? ""} onChange={set("parLevel")} dir="ltr" />
      </Field>

      {error && (
        <p className="md:col-span-2 text-sm" style={{ color: C.rose }}>{error}</p>
      )}

      <div className="md:col-span-2 flex flex-wrap gap-2">
        <button type="submit" disabled={busy}
          className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-60"
          style={{ background: C.iris, color: C.onPrimary }}>
          {editing ? t.inventory.saveChanges : t.inventory.addIngredient}
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
