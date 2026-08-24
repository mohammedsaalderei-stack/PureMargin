import { useEffect, useState } from "react";
import { Plus, Truck } from "lucide-react";
import OrderForm from "./OrderForm.jsx";
import OrderSheet from "./OrderSheet.jsx";
import { useC } from "../theme.jsx";
import { useLang } from "../i18n.jsx";
import { DirhamMark } from "../Dirham.jsx";

/* Purchase orders — the list, and raising a new one.

   Orders are listed newest first across every branch the user may see, so a
   buyer's queue is one place. The row leads with status because that is what the
   list is scanned for: what is still owed by a supplier. */

export default function PurchasingPanel({ token, onStockChanged }) {
  const C = useC();
  const { t } = useLang();
  const s = t.inventory.purchasing;

  const [list, setList] = useState(null);
  const [meta, setMeta] = useState(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState(null);

  const auth = { Authorization: `Bearer ${token}` };

  async function load() {
    const res = await fetch("/api/purchasing", { headers: auth });
    if (res.ok) setList(await res.json());
  }

  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* The suppliers and item list are only needed to raise an order, so they are
     fetched when the form opens rather than on every visit to the page. */
  async function startCreating() {
    setError("");
    const res = await fetch("/api/purchasing?what=new", { headers: auth });
    if (!res.ok) { setError(s.errors.failed); return; }
    setMeta(await res.json());
    setCreating(true);
  }

  async function save(body) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/purchasing?what=save", {
        method: "POST", headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const out = await res.json();
      if (!res.ok) { setError(s.errors[out.error] || s.errors.failed); return; }
      setCreating(false);
      await load();
      /* Straight into the order — the next step is sending it to the supplier. */
      setOpenId(out.order.id);
    } catch {
      setError(s.errors.failed);
    } finally {
      setBusy(false);
    }
  }

  if (!list) return null;

  const orders = list.orders || [];
  const names = list.branchNames || {};

  return (
    <>
      <div className="panel p-5 md:p-6">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="display font-bold text-base">{s.title}</h3>
            <p className="text-xs mt-1" style={{ color: C.slate }}>{s.note}</p>
          </div>
          {list.canManage && !creating && (list.branches || []).length > 0 && (
            <button onClick={startCreating}
              className="px-3 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 shrink-0"
              style={{ background: C.iris, color: C.onPrimary }}>
              <Plus size={14} /> {s.newOrder}
            </button>
          )}
        </div>

        {creating && meta && (
          <OrderForm meta={meta} busy={busy} error={error}
            onSave={save} onCancel={() => { setCreating(false); setError(""); }} />
        )}

        {!creating && error && <p className="text-sm mb-3" style={{ color: C.rose }}>{error}</p>}

        {orders.length === 0 ? (
          <div className="text-center py-8">
            <Truck size={28} className="mx-auto mb-3 flip-rtl" style={{ color: C.slate, opacity: 0.5 }} />
            <p className="text-sm" style={{ color: C.slate }}>{s.empty}</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {orders.map((order) => (
              <button key={order.id} onClick={() => setOpenId(openId === order.id ? null : order.id)}
                className="w-full flex items-center gap-3 p-3 rounded-lg text-start"
                style={{
                  background: "var(--chip-bg)",
                  border: `1px solid ${openId === order.id ? C.iris : "transparent"}`,
                  opacity: order.status === "cancelled" ? 0.55 : 1,
                }}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold truncate-safe">
                      {order.reference || order.supplierName || s.untitled}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                      style={{
                        background: C.hairline,
                        color: order.status === "partial" ? C.rose : C.iris,
                      }}>
                      {s.statuses[order.status]}
                    </span>
                  </div>
                  <div className="text-[11px] mt-0.5" style={{ color: C.slate }}>
                    {[
                      names[order.branchId] || order.branchId,
                      order.supplierName || s.noSupplier,
                      new Date(order.createdAt).toLocaleDateString(),
                    ].join(" · ")}
                  </div>
                </div>
                <div className="text-sm font-bold shrink-0 inline-flex items-baseline gap-[0.22em] tabular-nums" dir="ltr">
                  <DirhamMark />
                  {(order.summary?.orderedValue || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {openId && (
        <OrderSheet token={token} id={openId} onClose={() => setOpenId(null)}
          onChanged={() => { load(); onStockChanged?.(); }} />
      )}
    </>
  );
}
