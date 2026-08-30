import { useState, useEffect } from "react";
import { useC } from "../theme.jsx";
import { useLang } from "../i18n.jsx";

/* Record one stock movement — or, with the checkbox, a transfer between two
   branches.

   Transfers share this form rather than getting their own because they are the
   same entry with a second branch: splitting them into two screens is how a
   kitchen ends up recording an issue at one branch and a receipt at the other,
   which totals correctly and loses the fact that they were the same event.

   The unit picker only offers units in the ingredient's own dimension, so a
   quantity that cannot be converted can't be submitted. The server enforces the
   same rule; this only saves the user from discovering it as an error. */

const now = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

function Field({ label, hint, children }) {
  const C = useC();
  return (
    <label className="block">
      <span className="text-xs font-medium" style={{ color: C.slate }}>{label}</span>
      {children}
      {hint && <span className="block text-[11px] mt-1" style={{ color: C.slate }}>{hint}</span>}
    </label>
  );
}

export default function MovementForm({
  ingredients, branches, branchNames, types, units, busy, error, onSubmit, onCancel,
}) {
  const C = useC();
  const { t } = useLang();
  const s = t.inventory.stock;

  const [form, setForm] = useState({
    branchId: branches[0] || "",
    toBranchId: branches[1] || "",
    ingredientId: ingredients[0]?.id || "",
    type: "receive",
    qty: "",
    unit: ingredients[0]?.stockUnit || "",
    unitCost: "",
    reason: "",
    ref: "",
    date: now(),
    transfer: false,
  });
  const [showAll, setShowAll] = useState(false);

  const set = (key) => (e) =>
    setForm((f) => ({ ...f, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const ingredient = ingredients.find((i) => i.id === form.ingredientId) || null;
  const groups = units || { mass: [], volume: [], count: [] };
  const dimension = ["mass", "volume", "count"]
    .find((d) => (groups[d] || []).some((u) => u.key === ingredient?.stockUnit)) || "mass";
  const sameDim = groups[dimension] || [];

  /* Changing the ingredient can leave a unit behind from another dimension —
     kilograms selected, then a boxed item chosen. Snap back to its stock unit. */
  useEffect(() => {
    if (ingredient && !sameDim.some((u) => u.key === form.unit)) {
      setForm((f) => ({ ...f, unit: ingredient.stockUnit }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.ingredientId]);

  const input = {
    className: "mt-1 w-full px-3 py-2 rounded-lg text-sm",
    style: { background: C.bone, border: `1px solid ${C.hairline}`, color: C.ink },
  };

  /* Transfer is only meaningful with two branches in scope, and the two
     transfer-shaped types are written by that path rather than chosen by hand. */
  const canTransfer = branches.length > 1;
  const selectable = (types || []).filter((k) => k !== "transfer_in" && k !== "transfer_out");

  const submit = (e) => {
    e.preventDefault();
    const at = form.date ? new Date(`${form.date}T12:00:00`).getTime() : Date.now();
    const common = {
      ingredientId: form.ingredientId,
      qty: Number(form.qty),
      unit: form.unit,
      unitCost: form.unitCost === "" ? null : Number(form.unitCost),
      reason: form.reason,
      ref: form.ref,
      at,
    };
    onSubmit(
      form.transfer
        ? { transfer: true, ...common, fromBranchId: form.branchId, toBranchId: form.toBranchId }
        : { ...common, branchId: form.branchId, type: form.type }
    );
  };

  return (
    <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
      <Field label={s.ingredient} hint={s.ingredientHint}>
        <select {...input} value={form.ingredientId} onChange={set("ingredientId")} required>
          {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      </Field>

      {form.transfer ? (
        <Field label={s.from} hint={s.fromHint}>
          <select {...input} value={form.branchId} onChange={set("branchId")}>
            {branches.map((b) => <option key={b} value={b}>{branchNames[b] || b}</option>)}
          </select>
        </Field>
      ) : (
        <Field label={s.branch} hint={s.branchHint}>
          <select {...input} value={form.branchId} onChange={set("branchId")}>
            {branches.map((b) => <option key={b} value={b}>{branchNames[b] || b}</option>)}
          </select>
        </Field>
      )}

      {form.transfer ? (
        <Field label={s.to} hint={s.toHint}>
          <select {...input} value={form.toBranchId} onChange={set("toBranchId")}>
            {branches.map((b) => <option key={b} value={b}>{branchNames[b] || b}</option>)}
          </select>
        </Field>
      ) : (
        <Field label={s.type} hint={s.typeHint}>
          <select {...input} value={form.type} onChange={set("type")}>
            {selectable.map((k) => <option key={k} value={k}>{s.types[k] || k}</option>)}
          </select>
        </Field>
      )}

      <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
        <Field label={s.qty} hint={s.qtyHint}>
          <input {...input} type="number" step="any" value={form.qty} onChange={set("qty")} required dir="ltr"
            /* Only an adjustment may be negative; every other type takes its
               direction from the type, so the sign is not the user's problem. */
            min={form.type === "adjust" && !form.transfer ? undefined : "0"} />
        </Field>
        <Field label={s.unit} hint={s.unitHint}>
          <select {...input} value={form.unit} onChange={set("unit")}>
            {sameDim.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
          </select>
        </Field>
      </div>

      {/* A movement needs an ingredient, a quantity and a type. The date, the
          reference, the unit cost and the reason are things somebody supplies
          when they have them — and eleven boxes at once makes recording one
          delivery look like filing a return. */}
      {!showAll && (
        <button type="button" onClick={() => setShowAll(true)}
          className="text-xs font-semibold md:col-span-2 text-start" style={{ color: C.iris }}>
          {s.moreFields}
        </button>
      )}

      {showAll && (<>
      <Field label={s.date} hint={s.dateHint}>
        <input {...input} type="date" value={form.date} onChange={set("date")} dir="ltr" />
      </Field>

      <Field label={s.unitCost} hint={s.unitCostHint}>
        <input {...input} type="number" min="0" step="any" value={form.unitCost} onChange={set("unitCost")} dir="ltr" />
      </Field>

      <Field label={s.ref} hint={s.refHint}>
        <input {...input} value={form.ref} onChange={set("ref")} />
      </Field>

      <Field label={s.reason} hint={s.reasonHint}>
        <input {...input} value={form.reason} onChange={set("reason")} />
      </Field>

      {canTransfer && (
        <label className="md:col-span-2 flex items-center gap-2 text-xs" style={{ color: C.slate }}>
          <input type="checkbox" checked={form.transfer} onChange={set("transfer")} style={{ accentColor: C.iris }} />
          {s.isTransfer}
        </label>
      )}

      </>)}

      {error && <p className="md:col-span-2 text-sm" style={{ color: C.rose }}>{error}</p>}

      <div className="md:col-span-2 flex flex-wrap gap-2">
        <button type="submit" disabled={busy}
          className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-60"
          style={{ background: C.iris, color: C.onPrimary }}>
          {s.submit}
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
