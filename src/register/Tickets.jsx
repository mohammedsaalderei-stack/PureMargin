/* Open tickets: orders taken and not yet paid.

   Shared across every till in the business, newest first, each showing the
   table or name it was saved under, who took it, how long ago, and what it
   comes to at today's prices. Opening one puts it back on the till to add
   to or charge. Throwing one away is a void, which a manager does — or the
   person who took it. */

import { useCallback, useEffect, useState } from "react";
import { ClipboardList, Trash2, RefreshCw, Printer } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";
import { Btn, Empty, money } from "./ui.jsx";
import { call, RegisterError } from "./api.js";
import { priceOrder, ORDER_ICONS } from "./Sell.jsx";

const ago = (ms, P) => {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  return m < 60 ? fill(P.tickets.minutes, { n: m }) : fill(P.tickets.hours, { n: Math.floor(m / 60) });
};

export default function Tickets({ token, catalogue, branchId, canVoid, operator, onOpen, onPrint = null }) {
  const C = useC();
  const { t } = useLang();
  const P = t.pos;
  const [tickets, setTickets] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const out = await call(token, "tickets");
      setTickets((out.tickets || []).filter((tk) => !branchId || tk.branchId === branchId));
      setError("");
    } catch (err) {
      setError(err instanceof RegisterError ? P.errors.generic : P.errors.network);
      setTickets((x) => x || []);
    }
  }, [token, branchId, P.errors]);

  useEffect(() => { load(); const id = setInterval(load, 20000); return () => clearInterval(id); }, [load]);

  const remove = async (tk) => {
    if (!window.confirm(fill(P.tickets.voidConfirm, { name: tk.name || tk.table || "" }))) return;
    try { await call(token, "ticket", { method: "DELETE", query: { id: tk.id } }); load(); }
    catch { setError(P.errors.forbidden); }
  };

  if (tickets === null) return <Empty icon={ClipboardList} title={P.common.loading} />;

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="display font-bold text-xl">{P.views.tickets}</h2>
        <Btn kind="ghost" size="sm" onClick={load}><RefreshCw size={14} />{P.common.refresh}</Btn>
      </div>
      {error && <p className="text-sm mb-3" style={{ color: C.rose }}>{error}</p>}
      {!tickets.length ? (
        <Empty icon={ClipboardList} title={P.tickets.noneTitle} lead={P.tickets.noneLead} />
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
          {tickets.map((tk) => {
            const Icon = ORDER_ICONS[tk.orderType] || ClipboardList;
            const total = priceOrder({ ...tk, lines: tk.lines }, catalogue)?.receipt?.total_money;
            const count = tk.lines.reduce((s, l) => s + l.qty, 0);
            return (
              <div key={tk.id} className="rounded-3xl p-4 flex flex-col gap-3" style={{ background: C.surface, border: `1px solid ${C.hairline}` }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: C.slate }}>
                      <Icon size={13} />{P.orderTypes[tk.orderType]}{tk.table ? ` · ${P.order.table} ${tk.table}` : ""}
                    </div>
                    <div className="font-bold text-base truncate mt-0.5">{tk.name || (tk.table ? `${P.order.table} ${tk.table}` : fill(P.tickets.untitled, { time: new Date(tk.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }))}</div>
                  </div>
                  <span className="data font-bold text-base" dir="ltr">{total !== undefined ? money(total) : "—"}</span>
                </div>
                <div className="text-xs" style={{ color: C.slate }}>
                  {fill(P.tickets.meta, { n: count, by: tk.createdBy || "—", ago: ago(tk.updatedAt, P) })}
                </div>
                <div className="flex gap-2">
                  <Btn full onClick={() => onOpen(tk)}>{P.tickets.open}</Btn>
                  {onPrint && <Btn kind="ghost" onClick={() => onPrint(tk)} aria-label={P.tickets.printKitchen}><Printer size={16} /></Btn>}
                  {(canVoid || tk.createdBy === operator) && (
                    <Btn kind="danger" onClick={() => remove(tk)} aria-label={P.tickets.void}><Trash2 size={16} /></Btn>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
