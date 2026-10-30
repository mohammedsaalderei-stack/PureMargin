import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2, Minus, Plus, X, Banknote, CreditCard, Check, Receipt, Utensils, ShoppingBag, Car,
  Pencil, Trash2, ArrowLeft, ShoppingCart,
} from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";
import { Money } from "../Dirham.jsx";

/* The register: ring up a sale, take the money, keep the receipt.

   The dishes are the business's own recipes with a selling price, so a sale
   is costed and depletes stock without anybody pairing a till button to a
   recipe. The totals on this screen are for the person at the counter; the
   server works out the real ones from the catalogue and never takes a price
   from here (see `api/_till.js`). What is shown and what is charged come from
   the same rule, so they agree unless the menu changed in between, in which
   case the server says so and the menu is reloaded. */

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const ORDER_TYPES = [
  { id: "dine_in", icon: Utensils },
  { id: "takeaway", icon: ShoppingBag },
  { id: "car", icon: Car },
];

/* Start of the cashier's day, in the cashier's time zone. */
const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

export default function Till({ token }) {
  const C = useC();
  const { t } = useLang();
  const s = t.till;

  const [menu, setMenu] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [branch, setBranch] = useState("");
  const [orderType, setOrderType] = useState("dine_in");
  const [table, setTable] = useState("");
  const [category, setCategory] = useState("");
  const [cart, setCart] = useState([]);
  const [picking, setPicking] = useState(null);
  const [pricing, setPricing] = useState(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [paying, setPaying] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);
  const [view, setView] = useState("sell");

  const auth = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const res = await fetch("/api/till?what=catalogue", { headers: auth });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || String(res.status));
      setMenu(json);
      setBranch((b) => (json.branches.some((x) => x.id === b) ? b : json.branches[0]?.id || ""));
    } catch {
      setLoadError(s.errLoad);
    }
  }, [auth, s.errLoad]);

  useEffect(() => { load(); }, [load]);

  const categories = useMemo(
    () => [...new Set((menu?.items || []).map((i) => i.category).filter(Boolean))],
    [menu],
  );
  const shown = (menu?.items || []).filter((i) => !category || i.category === category);

  /* ── The order ── */

  const unitOf = (line) => round2(line.price + line.addons.reduce((sum, a) => sum + a.price, 0));
  const subtotal = round2(cart.reduce((sum, l) => sum + unitOf(l) * l.qty, 0));
  const vatPct = Number(menu?.vatPct) || 0;
  const vat = round2((subtotal * vatPct) / 100);
  const total = round2(subtotal + vat);
  const count = cart.reduce((n, l) => n + l.qty, 0);

  /* The same dish with the same add-ons is one line with a quantity. */
  const add = (item, addons = []) => {
    const ids = addons.map((a) => a.id).sort();
    const key = `${item.id}|${ids.join(",")}`;
    setCart((c) => {
      const hit = c.find((l) => l.key === key);
      if (hit) return c.map((l) => (l.key === key ? { ...l, qty: Math.min(999, l.qty + 1) } : l));
      return [...c, { key, itemId: item.id, name: item.name, price: item.price, addons, qty: 1 }];
    });
    setDone(null);
    setError("");
  };
  const step = (key, delta) => setCart((c) => c
    .map((l) => (l.key === key ? { ...l, qty: l.qty + delta } : l))
    .filter((l) => l.qty > 0));

  /* A dish with no selling price is on the menu but cannot be sold until it
     has one. A manager sets it here, on the recipe; a cashier is told to ask. */
  const tap = (item) => {
    if (!item.priced) { if (menu.canManageAddons) setPricing(item); return; }
    if (item.addons.length) setPicking({ item, chosen: [] });
    else add(item);
  };

  /* ── Payment ── */

  const charge = async () => {
    if (!cart.length || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/till?what=sale", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: branch,
          orderType,
          table: orderType === "dine_in" ? table : "",
          lines: cart.map((l) => ({ itemId: l.itemId, qty: l.qty, addons: l.addons.map((a) => a.id) })),
          payment: { type: paying.type, received: paying.type === "cash" && paying.received !== "" ? Number(paying.received) : undefined },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json.error === "short") setError(fill(s.errShort, { total: json.total.toFixed(2) }));
        else if (json.error === "item" || json.error === "addon") { setError(s.errMenu); load(); }
        else if (json.error === "branch") setError(s.errBranch);
        else setError(s.errSale);
        return;
      }
      setDone(json.receipt);
      setCart([]);
      setTable("");
      setPaying(null);
      setCartOpen(false);
    } catch {
      setError(s.errSale);
    } finally {
      setBusy(false);
    }
  };

  /* ── Loading and empty states ── */

  if (loadError) {
    return (
      <div className="h-full overflow-y-auto flex items-center justify-center p-8">
        <div className="max-w-sm text-center space-y-3">
          <p className="text-sm" style={{ color: C.slate }}>{loadError}</p>
          <button onClick={load} className="gpill gpill-primary px-4 py-2 text-sm font-semibold">{t.common.tryAgain}</button>
        </div>
      </div>
    );
  }
  if (!menu) {
    return (
      <div className="h-full overflow-y-auto flex items-center justify-center">
        <Loader2 size={20} className="animate-spin" style={{ color: C.slate }} />
      </div>
    );
  }

  const pill = (active) => ({
    background: active ? C.iris : "transparent",
    color: active ? C.onPrimary : C.ink,
    border: `1px solid ${active ? C.iris : C.hairline}`,
  });

  const cartPanel = (
    <CartPanel
      cart={cart} unitOf={unitOf} step={step} subtotal={subtotal} vat={vat} vatPct={vatPct} total={total}
      canManageVat={menu.canManageVat} token={token} onVatSaved={(v) => setMenu((m) => ({ ...m, vatPct: v }))}
      onCharge={() => { setError(""); setCartOpen(false); setPaying({ type: "cash", received: "" }); }}
      s={s} C={C}
    />
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-4 pb-28 lg:pb-6">
        {/* What kind of order, where, and for which branch. */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {ORDER_TYPES.map(({ id, icon: Icon }) => (
            <button key={id} onClick={() => setOrderType(id)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold" style={pill(orderType === id)}>
              <Icon size={15} /> {s.orderTypes[id]}
            </button>
          ))}
          {orderType === "dine_in" && (
            <input value={table} onChange={(e) => setTable(e.target.value.slice(0, 10))} inputMode="numeric"
              placeholder={s.table} aria-label={s.table}
              className="w-20 rounded-xl px-3 py-2 text-sm outline-none"
              style={{ background: C.surface, border: `1px solid ${C.hairline}`, color: C.ink }} />
          )}
          <div className="flex-1" />
          <button onClick={() => setView(view === "sell" ? "day" : "sell")}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold" style={pill(false)}>
            {view === "sell" ? <><Receipt size={15} /> {s.today}</> : <><ArrowLeft size={15} className="flip-rtl" /> {s.sell}</>}
          </button>
        </div>

        {menu.branches.length > 1 && (
          <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label={s.branch}
            className="mb-3 rounded-xl px-3 py-2 text-sm outline-none"
            style={{ background: C.surface, border: `1px solid ${C.hairline}`, color: C.ink }}>
            {menu.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        {!menu.branches.length && (
          <p className="text-sm mb-3" style={{ color: C.rose }}>{s.errNoBranch}</p>
        )}

        {view === "day" ? (
          <DayView token={token} branch={branch} s={s} C={C} />
        ) : (
          <div className="lg:grid lg:grid-cols-[1fr_360px] lg:gap-5 lg:items-start">
            <div>
              {done && <Paid receipt={done} onNew={() => setDone(null)} s={s} C={C} />}

              {categories.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-2 mb-2">
                  <button onClick={() => setCategory("")} className="shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold" style={pill(!category)}>{s.all}</button>
                  {categories.map((c) => (
                    <button key={c} onClick={() => setCategory(c)} className="shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold" style={pill(category === c)}>{c}</button>
                  ))}
                </div>
              )}

              {!menu.items.length ? (
                <div className="panel p-6 text-center text-sm" style={{ color: C.slate }}>{s.noItems}</div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5">
                  {shown.map((item) => (
                    <div key={item.id} className="relative">
                      <button onClick={() => tap(item)} disabled={!item.priced && !menu.canManageAddons}
                        className="panel p-3 w-full h-full text-start flex flex-col gap-2 active:scale-[0.98] transition-transform min-h-[92px]"
                        style={{
                          background: C.surface, border: `1px ${item.priced ? "solid" : "dashed"} ${C.hairline}`,
                          borderRadius: 16, opacity: item.priced ? 1 : 0.6,
                        }}>
                        <span className="font-semibold text-sm leading-snug line-clamp-2 pe-6" style={{ color: C.ink }}>{item.name}</span>
                        <span className="mt-auto flex items-center justify-between gap-2 text-sm" style={{ color: C.slate }}>
                          {item.priced ? <Money value={item.price} decimals={2} />
                            : <span className="text-xs">{menu.canManageAddons ? s.setPrice : s.askPrice}</span>}
                          {item.addons.length > 0 && <Plus size={14} style={{ color: C.iris }} />}
                        </span>
                      </button>
                      {/* A dish's first add-on has to be addable from somewhere:
                          the picker only opens for a dish that already has some. */}
                      {menu.canManageAddons && (
                        <button onClick={() => setPicking({ item, chosen: [], edit: true })} aria-label={s.editAddons}
                          className="absolute top-2 end-2 w-7 h-7 rounded-lg flex items-center justify-center" style={{ color: C.slate }}>
                          <Pencil size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <aside className="hidden lg:block panel p-4 sticky top-4">{cartPanel}</aside>
          </div>
        )}
      </div>

      {/* On a phone the order is a bar at the bottom that opens as a sheet. */}
      {view === "sell" && cart.length > 0 && !cartOpen && (
        <div className="lg:hidden fixed inset-x-0 bottom-0 z-30 px-4 pt-2"
          style={{ paddingBottom: "calc(var(--safe-bottom) + 12px)", background: `linear-gradient(transparent, ${C.bone} 30%)` }}>
          <button onClick={() => setCartOpen(true)}
            className="w-full flex items-center justify-between gap-3 px-4 py-3.5 rounded-2xl text-sm font-bold"
            style={{ background: C.iris, color: C.onPrimary }}>
            <span className="flex items-center gap-2"><ShoppingCart size={16} /> {fill(s.items, { n: count })}</span>
            <span className="flex items-center gap-2">{s.viewOrder} <Money value={total} decimals={2} /></span>
          </button>
        </div>
      )}
      {cartOpen && (
        <Sheet onClose={() => setCartOpen(false)} title={s.cart} C={C} s={s}>{cartPanel}</Sheet>
      )}

      {pricing && (
        <PriceSheet item={pricing} token={token} onClose={() => setPricing(null)} s={s} C={C}
          onSaved={(itemId, price) => {
            setMenu((m) => ({ ...m, items: m.items.map((i) => (i.id === itemId ? { ...i, price, priced: true } : i)) }));
            setPricing(null);
          }} />
      )}

      {picking && (
        <AddonPicker
          picking={picking} setPicking={setPicking} canManage={menu.canManageAddons} token={token}
          onAdd={(item, chosen) => { add(item, chosen); setPicking(null); }}
          onSaved={(itemId, addons) => setMenu((m) => ({ ...m, items: m.items.map((i) => (i.id === itemId ? { ...i, addons } : i)) }))}
          s={s} C={C}
        />
      )}

      {paying && (
        <PaySheet paying={paying} setPaying={setPaying} total={total} busy={busy} error={error}
          onConfirm={charge} onClose={() => { setPaying(null); setError(""); }} s={s} C={C} />
      )}
    </div>
  );
}

/* A panel that rises from the bottom on a phone and sits centred on a desk. */
function Sheet({ title, onClose, children, C, s }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
      style={{ background: C.scrim }} onClick={onClose}>
      <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 max-h-[85vh] overflow-y-auto palette-in"
        style={{ background: C.surface, border: `1px solid ${C.hairline}` }}
        onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="flex items-center justify-between mb-4">
          <h3 className="display font-bold text-base" style={{ color: C.ink }}>{title}</h3>
          <button onClick={onClose} aria-label={s.close} style={{ color: C.slate }}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function CartPanel({ cart, unitOf, step, subtotal, vat, vatPct, total, canManageVat, token, onVatSaved, onCharge, s, C }) {
  const [editingVat, setEditingVat] = useState(false);
  const [vatDraft, setVatDraft] = useState(String(vatPct));
  const [vatBusy, setVatBusy] = useState(false);

  const saveVat = async () => {
    setVatBusy(true);
    try {
      const res = await fetch("/api/till?what=vat", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ vatPct: Number(vatDraft) }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) { onVatSaved(json.vatPct); setEditingVat(false); }
    } finally {
      setVatBusy(false);
    }
  };

  const row = (label, value, strong) => (
    <div className={`flex items-center justify-between ${strong ? "text-base font-bold" : "text-sm"}`}
      style={{ color: strong ? C.ink : C.slate }}>
      <span>{label}</span>
      <Money value={value} decimals={2} />
    </div>
  );

  return (
    <div className="space-y-4">
      {!cart.length ? (
        <p className="text-sm text-center py-6" style={{ color: C.slate }}>{s.emptyCart}</p>
      ) : (
        <div className="space-y-3">
          {cart.map((l) => (
            <div key={l.key} className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate" style={{ color: C.ink }}>{l.name}</div>
                {l.addons.length > 0 && (
                  <div className="text-[11px] truncate" style={{ color: C.slate }}>{l.addons.map((a) => a.name).join(" · ")}</div>
                )}
                <div className="text-xs mt-0.5" style={{ color: C.slate }}><Money value={unitOf(l) * l.qty} decimals={2} /></div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0" dir="ltr">
                <button onClick={() => step(l.key, -1)} aria-label={s.less}
                  className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ border: `1px solid ${C.hairline}`, color: C.ink }}><Minus size={14} /></button>
                <span className="w-6 text-center text-sm font-semibold" style={{ color: C.ink }}>{l.qty}</span>
                <button onClick={() => step(l.key, 1)} aria-label={s.more}
                  className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ border: `1px solid ${C.hairline}`, color: C.ink }}><Plus size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1.5 pt-3" style={{ borderTop: `1px solid ${C.hairline}` }}>
        {row(s.subtotal, subtotal)}
        <div className="flex items-center justify-between text-sm" style={{ color: C.slate }}>
          {editingVat ? (
            <span className="flex items-center gap-1.5">
              <input value={vatDraft} onChange={(e) => setVatDraft(e.target.value)} inputMode="decimal" dir="ltr"
                className="w-14 rounded-lg px-2 py-1 text-sm outline-none" aria-label={s.vatRate}
                style={{ background: C.bone, border: `1px solid ${C.hairline}`, color: C.ink }} />%
              <button onClick={saveVat} disabled={vatBusy} aria-label={s.save} style={{ color: C.mint }}><Check size={16} /></button>
              <button onClick={() => { setEditingVat(false); setVatDraft(String(vatPct)); }} aria-label={s.close} style={{ color: C.slate }}><X size={16} /></button>
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              {fill(s.vat, { pct: vatPct })}
              {canManageVat && (
                <button onClick={() => setEditingVat(true)} aria-label={s.vatRate} style={{ color: C.iris }}><Pencil size={12} /></button>
              )}
            </span>
          )}
          <Money value={vat} decimals={2} />
        </div>
        {row(s.total, total, true)}
      </div>

      <button onClick={onCharge} disabled={!cart.length}
        className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-2xl text-sm font-bold disabled:opacity-40"
        style={{ background: C.iris, color: C.onPrimary }}>
        {s.charge} <Money value={total} decimals={2} />
      </button>
    </div>
  );
}

function PriceSheet({ item, token, onClose, onSaved, s, C }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/till?what=price", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, price: Number(value) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(s.errPrice); return; }
      onSaved(item.id, json.price);
    } catch {
      setErr(s.errPrice);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title={fill(s.priceFor, { name: item.name })} onClose={onClose} C={C} s={s}>
      <p className="text-sm mb-3" style={{ color: C.slate }}>{s.priceHint}</p>
      <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" dir="ltr" autoFocus
        aria-label={s.price} className="w-full px-3 py-3 rounded-xl text-base"
        style={{ background: "transparent", color: C.ink, border: `1px solid ${C.hairline}` }} />
      {err && <p className="text-sm mt-2" style={{ color: C.rose }}>{err}</p>}
      <button onClick={save} disabled={busy || !(Number(value) > 0)}
        className="w-full mt-4 py-3 rounded-xl text-sm font-bold disabled:opacity-50"
        style={{ background: C.iris, color: "#fff" }}>{s.savePrice}</button>
    </Sheet>
  );
}

function AddonPicker({ picking, setPicking, canManage, token, onAdd, onSaved, s, C }) {
  const { item, chosen } = picking;
  const [editing, setEditing] = useState(Boolean(picking.edit));
  const [rows, setRows] = useState(() => item.addons.map((a) => ({ name: a.name, price: String(a.price), cost: a.cost === null ? "" : String(a.cost) })));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const toggle = (addon) => setPicking({
    item,
    chosen: chosen.some((a) => a.id === addon.id) ? chosen.filter((a) => a.id !== addon.id) : [...chosen, addon],
  });
  const unit = round2(item.price + chosen.reduce((sum, a) => sum + a.price, 0));

  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/till?what=addons", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: item.id,
          addons: rows.filter((r) => r.name.trim()).map((r) => ({ name: r.name, price: Number(r.price) || 0, cost: r.cost === "" ? null : Number(r.cost) })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(s.errAddons); return; }
      onSaved(item.id, json.addons);
      setPicking({ item: { ...item, addons: json.addons }, chosen: [] });
      setEditing(false);
    } catch {
      setErr(s.errAddons);
    } finally {
      setBusy(false);
    }
  };

  const input = (value, onChange, props = {}) => (
    <input value={value} onChange={(e) => onChange(e.target.value)} {...props}
      className={`rounded-lg px-2.5 py-2 text-sm outline-none ${props.className || ""}`}
      style={{ background: C.bone, border: `1px solid ${C.hairline}`, color: C.ink }} />
  );

  return (
    <Sheet title={fill(s.addonsFor, { name: item.name })} onClose={() => setPicking(null)} C={C} s={s}>
      {!editing ? (
        <div className="space-y-2">
          {item.addons.map((a) => {
            const on = chosen.some((x) => x.id === a.id);
            return (
              <button key={a.id} onClick={() => toggle(a)}
                className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-sm text-start"
                style={{ border: `1px solid ${on ? C.iris : C.hairline}`, background: on ? C.irisWash : "transparent", color: C.ink }}>
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded flex items-center justify-center" style={{ border: `1px solid ${on ? C.iris : C.hairline}`, background: on ? C.iris : "transparent" }}>
                    {on && <Check size={11} style={{ color: C.onPrimary }} />}
                  </span>
                  {a.name}
                </span>
                <span className="flex items-center gap-1" style={{ color: C.slate }}>+<Money value={a.price} decimals={2} /></span>
              </button>
            );
          })}
          <div className="flex items-center justify-between text-sm pt-2" style={{ color: C.slate }}>
            <span>{s.unitPrice}</span><Money value={unit} decimals={2} />
          </div>
          <button onClick={() => onAdd(item, chosen)}
            className="w-full px-4 py-3 rounded-xl text-sm font-bold" style={{ background: C.iris, color: C.onPrimary }}>
            {s.addToOrder}
          </button>
          {canManage && (
            <button onClick={() => setEditing(true)} className="w-full text-xs font-semibold pt-1 flex items-center justify-center gap-1.5" style={{ color: C.slate }}>
              <Pencil size={12} /> {s.editAddons}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_4.5rem_4.5rem_2rem] gap-1.5 text-[11px] font-semibold" style={{ color: C.slate }}>
            <span>{s.addonName}</span><span>{s.price}</span><span>{s.cost}</span><span />
          </div>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_4.5rem_4.5rem_2rem] gap-1.5 items-center">
              {input(r.name, (v) => setRows(rows.map((x, j) => (j === i ? { ...x, name: v } : x))), { "aria-label": s.addonName })}
              {input(r.price, (v) => setRows(rows.map((x, j) => (j === i ? { ...x, price: v } : x))), { inputMode: "decimal", dir: "ltr", "aria-label": s.price })}
              {input(r.cost, (v) => setRows(rows.map((x, j) => (j === i ? { ...x, cost: v } : x))), { inputMode: "decimal", dir: "ltr", "aria-label": s.cost })}
              <button onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={s.remove} style={{ color: C.rose }}><Trash2 size={15} /></button>
            </div>
          ))}
          <button onClick={() => setRows([...rows, { name: "", price: "", cost: "" }])}
            className="text-xs font-semibold flex items-center gap-1.5" style={{ color: C.iris }}>
            <Plus size={13} /> {s.addAddon}
          </button>
          <p className="text-[11px]" style={{ color: C.slate }}>{s.costHint}</p>
          {err && <p className="text-xs" style={{ color: C.rose }}>{err}</p>}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button onClick={() => setEditing(false)} className="px-4 py-2.5 rounded-xl text-sm font-semibold" style={{ border: `1px solid ${C.hairline}`, color: C.ink }}>{s.close}</button>
            <button onClick={save} disabled={busy} className="px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50" style={{ background: C.iris, color: C.onPrimary }}>
              {busy ? s.saving : s.save}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function PaySheet({ paying, setPaying, total, busy, error, onConfirm, onClose, s, C }) {
  const received = paying.received === "" ? total : Number(paying.received);
  const change = paying.type === "cash" && Number.isFinite(received) ? round2(received - total) : 0;
  /* Notes a customer is likely to hand over: the exact amount, then the next
     round figures above it. */
  const quick = [...new Set([total, Math.ceil(total / 10) * 10, Math.ceil(total / 50) * 50, Math.ceil(total / 100) * 100])]
    .filter((n) => n >= total).slice(0, 4);

  return (
    <Sheet title={s.payTitle} onClose={onClose} C={C} s={s}>
      <div className="space-y-4">
        <div className="text-center">
          <div className="text-xs" style={{ color: C.slate }}>{s.due}</div>
          <div className="display text-3xl font-bold" style={{ color: C.ink }}><Money value={total} decimals={2} /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[{ id: "cash", icon: Banknote, label: s.cash }, { id: "card", icon: CreditCard, label: s.card }].map(({ id, icon: Icon, label }) => (
            <button key={id} onClick={() => setPaying({ ...paying, type: id })}
              className="flex items-center justify-center gap-2 px-3 py-3 rounded-xl text-sm font-semibold"
              style={{ background: paying.type === id ? C.iris : "transparent", color: paying.type === id ? C.onPrimary : C.ink, border: `1px solid ${paying.type === id ? C.iris : C.hairline}` }}>
              <Icon size={16} /> {label}
            </button>
          ))}
        </div>
        {paying.type === "cash" ? (
          <div className="space-y-2">
            <label className="text-xs font-semibold block" style={{ color: C.slate }}>{s.received}</label>
            <input value={paying.received} onChange={(e) => setPaying({ ...paying, received: e.target.value })}
              inputMode="decimal" dir="ltr" placeholder={total.toFixed(2)} aria-label={s.received}
              className="w-full rounded-xl px-3 py-3 text-lg outline-none"
              style={{ background: C.bone, border: `1px solid ${C.hairline}`, color: C.ink }} />
            <div className="flex flex-wrap gap-2">
              {quick.map((n) => (
                <button key={n} onClick={() => setPaying({ ...paying, received: String(n) })}
                  className="px-3 py-1.5 rounded-full text-xs font-semibold" style={{ border: `1px solid ${C.hairline}`, color: C.ink }}>
                  <Money value={n} decimals={n % 1 ? 2 : 0} />
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between text-sm font-semibold pt-1"
              style={{ color: change < 0 ? C.rose : C.mint }}>
              <span>{s.change}</span><Money value={Math.max(0, change)} decimals={2} />
            </div>
          </div>
        ) : (
          <p className="text-xs text-center" style={{ color: C.slate }}>{s.cardHint}</p>
        )}
        {error && <p className="text-xs" style={{ color: C.rose }}>{error}</p>}
        <button onClick={onConfirm} disabled={busy || (paying.type === "cash" && change < 0)}
          className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-2xl text-sm font-bold disabled:opacity-50"
          style={{ background: C.mint, color: "#0b1410" }}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {s.confirm}
        </button>
      </div>
    </Sheet>
  );
}

function Paid({ receipt, onNew, s, C }) {
  const pay = receipt.payments?.[0] || {};
  return (
    <div className="panel p-4 mb-3 flex items-center gap-3" style={{ borderColor: C.mint }}>
      <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: C.mint }}>
        <Check size={18} style={{ color: "#0b1410" }} />
      </span>
      <div className="flex-1 min-w-0 text-sm">
        <div className="font-bold" style={{ color: C.ink }}>{s.paid} · <Money value={receipt.total_money} decimals={2} /></div>
        <div className="text-xs truncate" style={{ color: C.slate }}>
          {fill(s.receiptNo, { n: receipt.receipt_number })}
          {pay.change > 0 && <> · {s.change} <Money value={pay.change} decimals={2} /></>}
        </div>
      </div>
      <button onClick={onNew} className="text-xs font-semibold shrink-0" style={{ color: C.iris }}>{s.newOrder}</button>
    </div>
  );
}

function DayView({ token, branch, s, C }) {
  const [day, setDay] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const qs = new URLSearchParams({ what: "day", from: String(startOfDay()), to: String(Date.now()) });
    if (branch) qs.set("branches", branch);
    fetch(`/api/till?${qs}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => { if (live) setDay(j); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [token, branch]);

  if (failed) return <p className="text-sm" style={{ color: C.rose }}>{s.errLoad}</p>;
  if (!day) return <Loader2 size={18} className="animate-spin" style={{ color: C.slate }} />;

  const tile = (label, value) => (
    <div className="panel p-3">
      <div className="text-[11px]" style={{ color: C.slate }}>{label}</div>
      <div className="font-bold text-base" style={{ color: C.ink }}>{value}</div>
    </div>
  );
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {tile(s.salesCount, day.totals.count)}
        {tile(s.total, <Money value={day.totals.total} decimals={2} />)}
        {tile(s.cash, <Money value={day.totals.cash} decimals={2} />)}
        {tile(s.card, <Money value={day.totals.card} decimals={2} />)}
      </div>
      {!day.receipts.length ? (
        <div className="panel p-6 text-center text-sm" style={{ color: C.slate }}>{s.noSales}</div>
      ) : (
        <div className="panel divide-y" style={{ borderColor: C.hairline }}>
          {day.receipts.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3 text-sm" style={{ borderColor: C.hairline }}>
              <span className="w-12 shrink-0 text-xs" dir="ltr" style={{ color: C.slate }}>
                {new Date(r.receipt_date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
              <span className="flex-1 min-w-0 truncate" style={{ color: C.ink }}>
                {r.line_items.map((l) => `${l.quantity}× ${l.item_name}`).join(", ")}
              </span>
              <span className="text-xs shrink-0" style={{ color: C.slate }}>{r.payments?.[0]?.type === "CARD" ? s.card : s.cash}</span>
              <span className="font-semibold shrink-0" style={{ color: C.ink }}><Money value={r.total_money} decimals={2} /></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
