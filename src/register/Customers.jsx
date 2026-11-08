/* Customers: who comes back, what they spend, and the points they hold. */

import { useState } from "react";
import { Users, Search, UserPlus } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";
import { Btn, Sheet, Row, Empty, money } from "./ui.jsx";
import { CustomerForm } from "./CustomerPicker.jsx";

export default function Customers({ token, customers, onChanged }) {
  const C = useC();
  const { t } = useLang();
  const P = t.pos;
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);
  const shown = customers.filter((c) => !q || `${c.name} ${c.phone} ${c.email}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="p-4 pb-2 shrink-0 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="display font-bold text-xl">{P.views.customers}</h2>
          <Btn size="sm" onClick={() => setEditing({})}><UserPlus size={14} />{P.customers.add}</Btn>
        </div>
        <div className="flex items-center gap-2 px-3.5 rounded-2xl" style={{ background: "var(--chip-bg)" }}>
          <Search size={16} style={{ color: C.slate }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={P.customers.search}
            className="flex-1 bg-transparent py-3 text-sm outline-none" style={{ color: C.ink }} />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-6">
        {!customers.length ? <Empty icon={Users} title={P.customers.noneTitle} lead={P.customers.noneLead} /> : shown.map((c) => (
          <button key={c.id} onClick={() => setEditing(c)} className="w-full flex items-center justify-between gap-3 py-3 text-start" style={{ borderBottom: `1px solid ${C.hairline}` }}>
            <span className="min-w-0">
              <span className="block text-sm font-semibold truncate">{c.name}</span>
              <span className="block text-xs" style={{ color: C.slate }} dir="ltr">{c.phone || c.email || "—"}</span>
            </span>
            <span className="text-end">
              <span className="block data text-sm font-bold" dir="ltr">{money(c.spent || 0)}</span>
              <span className="block text-xs" style={{ color: C.slate }}>{fill(P.customers.visits, { n: c.visits || 0 })}</span>
            </span>
          </button>
        ))}
      </div>
      {editing && (
        <Sheet title={editing.id ? editing.name : P.customers.add} onClose={() => setEditing(null)}>
          {editing.id && (
            <div className="rounded-2xl p-4 mb-4" style={{ background: "var(--chip-bg)" }}>
              <Row label={P.customers.spent} value={money(editing.spent || 0)} strong />
              <Row label={P.customers.visitsLabel} value={String(editing.visits || 0)} muted />
              <Row label={P.customers.pointsLabel} value={money(editing.points || 0)} muted />
              {editing.lastVisit && <Row label={P.customers.lastVisit} value={new Date(editing.lastVisit).toLocaleDateString()} muted />}
            </div>
          )}
          <CustomerForm token={token} initial={editing} onSaved={() => { setEditing(null); onChanged(); }} />
        </Sheet>
      )}
    </div>
  );
}
