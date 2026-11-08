/* Finding a customer, or adding one, without leaving the order.

   Searched by name or phone, because the phone number is what a regular
   reads out. Adding asks for a name and nothing else is required. */

import { useState } from "react";
import { Search, UserPlus, Check } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";
import { Sheet, Btn, Field, money } from "./ui.jsx";
import { call, RegisterError } from "./api.js";

export function CustomerForm({ token, initial, onSaved, onCancel }) {
  const C = useC();
  const { t } = useLang();
  const P = t.pos;
  const [draft, setDraft] = useState({ name: "", phone: "", email: "", note: "", ...initial });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const out = await call(token, "customer", { method: "PUT", body: draft });
      onSaved(out.customer);
    } catch (err) {
      const code = err instanceof RegisterError ? err.body?.error : "network";
      setError(P.customers.errors[code] || P.errors.generic);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <Field label={P.customers.name} value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} autoFocus />
      <Field label={P.customers.phone} value={draft.phone} onChange={(v) => setDraft({ ...draft, phone: v })} inputMode="tel" dir="ltr" />
      <Field label={P.customers.email} value={draft.email} onChange={(v) => setDraft({ ...draft, email: v })} inputMode="email" dir="ltr" />
      <Field label={P.customers.note} value={draft.note} onChange={(v) => setDraft({ ...draft, note: v })} />
      {error && <p className="text-sm mb-2" style={{ color: C.rose }}>{error}</p>}
      <div className="flex gap-2">
        {onCancel && <Btn kind="ghost" onClick={onCancel}>{P.common.cancel}</Btn>}
        <Btn full disabled={busy || !draft.name.trim()} onClick={save}>{P.common.save}</Btn>
      </div>
    </div>
  );
}

export default function CustomerPicker({ token, customers, selected, onPick, onChanged, onClose }) {
  const C = useC();
  const { t } = useLang();
  const P = t.pos;
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const shown = customers.filter((c) => !q || `${c.name} ${c.phone}`.toLowerCase().includes(q.toLowerCase())).slice(0, 50);
  return (
    <Sheet title={adding ? P.customers.add : P.customers.pick} onClose={onClose}>
      {adding ? (
        <CustomerForm token={token} initial={/^\+?\d+$/.test(q) ? { phone: q } : { name: q }}
          onCancel={() => setAdding(false)}
          onSaved={(c) => { onChanged?.(); onPick(c.id); }} />
      ) : (
        <>
          <div className="flex items-center gap-2 px-3.5 rounded-2xl mb-3" style={{ background: "var(--chip-bg)" }}>
            <Search size={16} style={{ color: C.slate }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={P.customers.search} autoFocus
              className="flex-1 bg-transparent py-3 text-sm outline-none" style={{ color: C.ink }} />
          </div>
          <Btn full kind="ghost" onClick={() => setAdding(true)} className="mb-3"><UserPlus size={16} />{P.customers.add}</Btn>
          {selected && <Btn full kind="outline" className="mb-3" onClick={() => onPick("")}>{P.customers.remove}</Btn>}
          <div className="space-y-1">
            {shown.map((c) => (
              <button key={c.id} onClick={() => onPick(c.id)} className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl text-start"
                style={{ background: c.id === selected ? C.irisWash : "transparent" }}>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold truncate">{c.name}</span>
                  <span className="block text-xs" style={{ color: C.slate }} dir="ltr">{c.phone || c.email || "—"}</span>
                </span>
                <span className="text-end shrink-0">
                  <span className="block text-xs" style={{ color: C.slate }}>{fill(P.customers.visits, { n: c.visits || 0 })}</span>
                  {c.points > 0 && <span className="block text-xs font-semibold" style={{ color: C.iris }}>{fill(P.customers.points, { n: money(c.points) })}</span>}
                </span>
                {c.id === selected && <Check size={16} style={{ color: C.iris }} />}
              </button>
            ))}
            {!shown.length && <p className="text-sm text-center py-6" style={{ color: C.slate }}>{P.customers.none}</p>}
          </div>
        </>
      )}
    </Sheet>
  );
}
