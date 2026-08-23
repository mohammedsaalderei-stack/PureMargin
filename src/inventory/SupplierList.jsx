import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";

/* Suppliers. Small on purpose: a name is enough to be useful, and lead time is
   the one extra field that earns its place — the reorder alerts in a later phase
   can only say "order now" if they know how long delivery takes.

   A supplier still referenced by an ingredient cannot be removed. The server
   refuses with a count, and that count is shown, because "you can't" without
   "here's why" is the kind of dead end people work around by creating a
   duplicate. */

export default function SupplierList({ token, suppliers, canManage, onChanged }) {
  const C = useC();
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [leadTimeDays, setLead] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const auth = { Authorization: `Bearer ${token}` };

  async function add(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/inventory?what=supplier", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ name, leadTimeDays: leadTimeDays === "" ? null : Number(leadTimeDays) }),
      });
      if (!res.ok) { setError(t.inventory.failed); return; }
      setName(""); setLead(""); setOpen(false);
      onChanged?.();
    } finally { setBusy(false); }
  }

  async function remove(id) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/inventory?what=supplier&id=${encodeURIComponent(id)}`, {
        method: "DELETE", headers: auth,
      });
      if (res.status === 409) {
        const out = await res.json();
        setError(fill(t.inventory.supplierInUse, { n: out.count }));
        return;
      }
      onChanged?.();
    } finally { setBusy(false); }
  }

  const input = {
    className: "px-3 py-2 rounded-lg text-sm",
    style: { background: C.bone, border: `1px solid ${C.hairline}`, color: C.ink },
  };

  return (
    <div className="panel p-5 md:p-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="display font-bold text-base">{t.inventory.suppliersTitle}</h3>
          <p className="text-xs mt-1" style={{ color: C.slate }}>{t.inventory.suppliersNote}</p>
        </div>
        {canManage && !open && (
          <button onClick={() => setOpen(true)}
            className="px-3 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 shrink-0"
            style={{ border: `1px solid ${C.hairline}`, color: C.slate }}>
            <Plus size={14} /> {t.inventory.addSupplier}
          </button>
        )}
      </div>

      {open && (
        <form onSubmit={add} className="flex flex-wrap items-end gap-2 mb-4">
          <input {...input} value={name} onChange={(e) => setName(e.target.value)}
            placeholder={t.inventory.supplierName} required className={`${input.className} flex-1 min-w-[160px]`} />
          <input {...input} type="number" min="0" value={leadTimeDays} onChange={(e) => setLead(e.target.value)}
            placeholder={t.inventory.leadTime} dir="ltr" className={`${input.className} w-28`} />
          <button type="submit" disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-60"
            style={{ background: C.iris, color: C.onPrimary }}>
            {t.inventory.save}
          </button>
          <button type="button" onClick={() => { setOpen(false); setError(""); }}
            className="px-4 py-2 rounded-lg text-sm font-semibold"
            style={{ border: `1px solid ${C.hairline}`, color: C.slate }}>
            {t.inventory.cancel}
          </button>
        </form>
      )}

      {error && <p className="text-sm mb-3" style={{ color: C.rose }}>{error}</p>}

      {suppliers.length === 0 ? (
        <p className="text-xs" style={{ color: C.slate }}>{t.inventory.noSuppliers}</p>
      ) : (
        <div className="space-y-1.5">
          {suppliers.map((s) => (
            <div key={s.id} className="flex items-center gap-3 p-2.5 rounded-lg" style={{ background: "var(--chip-bg)" }}>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate-safe">{s.name}</div>
                {s.leadTimeDays !== null && s.leadTimeDays !== undefined && (
                  <div className="text-[11px]" style={{ color: C.slate }}>
                    {fill(t.inventory.leadTimeDays, { n: s.leadTimeDays })}
                  </div>
                )}
              </div>
              {canManage && (
                <button onClick={() => remove(s.id)} disabled={busy}
                  className="p-2 rounded-lg hover-soft" style={{ color: C.slate }}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
