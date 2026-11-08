/* Selling: the grid of things to sell, and the order being built.

   On a tablet or a computer the order sits beside the grid, always visible,
   the way a counter till is laid out. On a phone the grid has the screen and
   the order is a bar at the bottom that opens as a sheet.

   Totals on screen are worked out by the same code the server prices a sale
   with (`shared/tillprice.js`), so the figure a cashier reads out is the
   figure that is charged — discounts, VAT included or added, and all.

   A barcode scanner is a keyboard that types very fast and presses Enter.
   Anything typed that way while this screen is open is looked up as a
   barcode or SKU and rung up. */

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Plus, Minus, Trash2, Percent, UserRound, StickyNote, Save, ShoppingBag, Utensils, Car, Bike, Tag, ChevronUp, X } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";
import { buildSale } from "../../shared/tillprice.js";
import { Sheet, Btn, Field, Seg, Row, Empty, money, useExit } from "./ui.jsx";
import Charge from "./Charge.jsx";
import { pictureSrc } from "./itemImage.js";
import CustomerPicker from "./CustomerPicker.jsx";

export const ORDER_ICONS = { dine_in: Utensils, takeaway: ShoppingBag, car: Car, delivery: Bike };

const newKey = () => `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/* "Latte · Large" — the item and, when it has sizes, which one. */
export function lineName(item, line, P) {
  if (!item) return line.itemId;
  const v = line.variantId ? (item.variants || []).find((x) => x.id === line.variantId) : null;
  return v ? `${item.name} · ${v.name || P.variants.regular}` : item.name;
}

export function emptyOrder(orderType = "takeaway") {
  return { orderType, table: "", ticketName: "", customerId: "", discount: null, note: "", lines: [], ticketId: null, printed: {} };
}

/* What the order comes to, priced exactly as the server will price it. */
export function priceOrder(order, catalogue) {
  if (!order.lines.length) return null;
  const firstType = catalogue.paymentTypes?.[0]?.id || "cash";
  const out = buildSale({ ...order, payments: [{ type: firstType }] }, {
    catalogue: catalogue.items,
    vatPct: catalogue.vatPct,
    vatMode: catalogue.vatMode,
    paymentTypes: catalogue.paymentTypes,
    discounts: catalogue.discounts,
    loyaltyPct: catalogue.loyaltyPct,
    pointsBalance: Number.MAX_SAFE_INTEGER,
  });
  return out;
}

export default function Sell({ token, catalogue, order, setOrder, branchId, wide, customers, onCustomersChanged, onSaveTicket, onSold, can, onSetPrice, busy }) {
  const C = useC();
  const { t } = useLang();
  const P = t.pos;
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState(null);
  const [editing, setEditing] = useState(null);
  const [orderSheet, setOrderSheet] = useState(false);
  const [discountFor, setDiscountFor] = useState(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [charging, setCharging] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [flash, setFlash] = useState("");
  const [sheetLeaving, closeOrderSheet] = useExit(() => setOrderSheet(false));

  const items = useMemo(() => (catalogue.items || []).filter((i) => !i.hidden), [catalogue.items]);
  const categories = useMemo(() => [...new Set(items.map((i) => i.category).filter(Boolean))], [items]);
  const shown = items.filter((i) => (!category || i.category === category)
    && (!query || `${i.name} ${i.sku} ${i.barcode}`.toLowerCase().includes(query.toLowerCase())));
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const add = (item, addons = [], qty = 1, variantId = "") => {
    setOrder((o) => {
      const same = o.lines.find((l) => l.itemId === item.id && (l.variantId || "") === variantId && !l.discount && !l.note
        && JSON.stringify([...l.addons].sort()) === JSON.stringify([...addons].sort()));
      if (same) return { ...o, lines: o.lines.map((l) => (l === same ? { ...l, qty: l.qty + qty } : l)) };
      return { ...o, lines: [...o.lines, { key: newKey(), itemId: item.id, ...(variantId ? { variantId } : {}), qty, addons, discount: null, note: "" }] };
    });
  };
  const sellable = (item) => (item.variants || []).filter((v) => v.price > 0);
  /* An item with sizes or add-ons asks which; a scanned variant's barcode
     says already. */
  const tap = (item, variantId = "") => {
    if (!item.priced) { if (can.manageItems) onSetPrice(item); return; }
    const sizes = sellable(item);
    if (variantId && !item.addons?.length) { add(item, [], 1, variantId); return; }
    if (sizes.length > 1 || item.addons?.length) setPicking({ item, chosen: [], qty: 1, variantId: variantId || sizes[0]?.id || "" });
    else add(item, [], 1, sizes[0]?.id || "");
  };
  const setLine = (key, patch) => setOrder((o) => ({ ...o, lines: o.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const removeLine = (key) => setOrder((o) => ({ ...o, lines: o.lines.filter((l) => l.key !== key) }));

  /* The barcode scanner. */
  const buffer = useRef({ text: "", at: 0 });
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const now = Date.now();
      if (now - buffer.current.at > 80) buffer.current.text = "";
      buffer.current.at = now;
      if (e.key === "Enter") {
        const code = buffer.current.text;
        buffer.current.text = "";
        if (code.length >= 3) {
          const hit = items.find((i) => i.barcode === code || (i.sku && i.sku === code));
          const viaVariant = !hit && items.map((i) => ({ i, v: (i.variants || []).find((v) => v.barcode === code || (v.sku && v.sku === code)) })).find((x) => x.v);
          if (hit) { tap(hit); setFlash(hit.name); }
          else if (viaVariant) { tap(viaVariant.i, viaVariant.v.id); setFlash(`${viaVariant.i.name} · ${viaVariant.v.name || P.variants.regular}`); }
          else setFlash(fill(P.sell.unknownCode, { code }));
          setTimeout(() => setFlash(""), 1800);
        }
      } else if (e.key.length === 1) buffer.current.text += e.key;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const priced = priceOrder(order, catalogue);
  const receipt = priced?.receipt || null;
  const priceError = priced?.error || null;
  const count = order.lines.reduce((s, l) => s + l.qty, 0);
  const customer = customers.find((c) => c.id === order.customerId) || null;

  const grid = (
    <div className="h-full flex flex-col min-h-0">
      <div className="px-4 pt-3 pb-2 space-y-2.5 shrink-0">
        <div className="flex items-center gap-2 px-3.5 rounded-2xl" style={{ background: "var(--chip-bg)" }}>
          <Search size={16} style={{ color: C.slate }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={P.sell.search}
            className="flex-1 bg-transparent py-3 text-sm outline-none" style={{ color: C.ink }} />
          {query && <button onClick={() => setQuery("")} style={{ color: C.slate }}><X size={15} /></button>}
        </div>
        {categories.length > 0 && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {["", ...categories].map((c) => (
              <button key={c || "all"} onClick={() => setCategory(c)}
                className="shrink-0 px-4 py-2 rounded-full text-sm font-semibold"
                style={{ background: c === category ? C.ink : "var(--chip-bg)", color: c === category ? C.surface : C.ink }}>
                {c || P.sell.all}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-28 lg:pb-4">
        {!items.length ? (
          <Empty icon={ShoppingBag} title={P.sell.noItemsTitle} lead={P.sell.noItemsLead} />
        ) : (
          <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${wide ? 150 : 130}px, 1fr))` }}>
            {shown.map((item) => (
              <button key={item.id} onClick={() => tap(item)} disabled={!item.priced && !can.manageItems}
                className="relative text-start rounded-2xl overflow-hidden flex flex-col active:scale-[0.97] transition-transform"
                style={{ background: C.surface, border: `1px ${item.priced ? "solid" : "dashed"} ${C.hairline}`, opacity: item.priced ? 1 : 0.55 }}>
                {/* A picture when the item has one; otherwise its colour as a
                    strip along the top, as before. */}
                {item.image ? (
                  <img src={pictureSrc(item.image)} alt="" loading="lazy" decoding="async"
                    className="w-full aspect-[4/3] object-cover" style={{ background: "var(--chip-bg)" }} />
                ) : (
                  <span className="absolute top-0 inset-x-0 h-1" style={{ background: item.color || "transparent" }} />
                )}
                <span className={`flex-1 flex flex-col justify-between p-3 ${item.image ? "pt-2" : "min-h-[96px]"}`}>
                <span className="font-semibold text-sm leading-snug line-clamp-2" style={{ color: C.ink }}>{item.name}</span>
                <span className="flex items-center justify-between gap-1 mt-2">
                  <span className="data text-sm font-bold" dir="ltr" style={{ color: item.priced ? C.iris : C.slate }}>
                    {item.priced
                      ? (sellable(item).length > 1 ? fill(P.variants.from, { price: money(item.price) }) : money(item.price))
                      : (can.manageItems ? P.sell.setPrice : P.sell.noPrice)}
                  </span>
                  {(item.addons?.length > 0 || sellable(item).length > 1) && <Plus size={13} style={{ color: C.slate }} />}
                </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const orderTypes = (catalogue.orderTypes || ["dine_in", "takeaway"]).map((v) => {
    const Icon = ORDER_ICONS[v];
    return { value: v, label: P.orderTypes[v], icon: Icon ? <Icon size={14} /> : null };
  });

  /* Beside the menu on a tablet the panel fills its column; in the sheet on a
     phone it is as tall as the order, up to most of the screen, so two items
     do not sit above a screen of empty space with the total pushed to the
     bottom. */
  const panel = (
    <div className={`${wide ? "h-full" : "flex-1"} flex flex-col min-h-0`}>
      <div className="px-4 pt-3 space-y-2.5 shrink-0">
        <div className="overflow-x-auto no-scrollbar"><Seg options={orderTypes} value={order.orderType} onChange={(v) => setOrder((o) => ({ ...o, orderType: v }))} /></div>
        <div className="flex gap-2">
          {order.orderType === "dine_in" && (
            <input value={order.table} onChange={(e) => setOrder((o) => ({ ...o, table: e.target.value.slice(0, 10) }))}
              placeholder={P.order.table} className="w-24 px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: "var(--chip-bg)", color: C.ink }} />
          )}
          <button onClick={() => setCustomerOpen(true)} className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold min-w-0"
            style={{ background: customer ? C.irisWash : "var(--chip-bg)", color: customer ? C.iris : C.slate }}>
            <UserRound size={15} className="shrink-0" />
            <span className="truncate">{customer ? customer.name : P.order.addCustomer}</span>
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2">
        {!order.lines.length ? (
          <p className="text-sm text-center py-10" style={{ color: C.slate }}>{P.order.empty}</p>
        ) : order.lines.map((line, i) => {
          const item = byId.get(line.itemId);
          const li = receipt?.line_items?.[i];
          return (
            <div key={line.key} className="flex items-center gap-2 py-2.5 line-in rounded-lg" style={{ borderBottom: `1px solid ${C.hairline}` }}>
              <button onClick={() => setEditing(line.key)} className="flex-1 min-w-0 text-start">
                <span className="block text-sm font-semibold truncate" style={{ color: C.ink }}>{lineName(item, line, P)}</span>
                {line.addons.length > 0 && (
                  <span className="block text-xs truncate" style={{ color: C.slate }}>
                    + {line.addons.map((a) => item?.addons?.find((x) => x.id === a)?.name || a).join(", ")}
                  </span>
                )}
                {line.note && <span className="block text-xs truncate italic" style={{ color: C.slate }}>{line.note}</span>}
                {line.discount && <span className="block text-xs" style={{ color: C.mint }}>{P.order.discount} −{money(li?.total_discount || 0)}</span>}
              </button>
              <div className="flex items-center gap-1 shrink-0" dir="ltr">
                <button onClick={() => (line.qty > 1 ? setLine(line.key, { qty: line.qty - 1 }) : removeLine(line.key))}
                  className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "var(--chip-bg)", color: C.ink }}>
                  {line.qty > 1 ? <Minus size={14} /> : <Trash2 size={13} />}
                </button>
                <span className="w-7 text-center data text-sm font-bold">{line.qty}</span>
                <button onClick={() => setLine(line.key, { qty: Math.min(999, line.qty + 1) })}
                  className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "var(--chip-bg)", color: C.ink }}>
                  <Plus size={14} />
                </button>
              </div>
              <span className="w-16 text-end data text-sm font-semibold shrink-0" dir="ltr">{money(li?.total_money ?? 0)}</span>
            </div>
          );
        })}
      </div>

      <div className="px-4 pt-2 shrink-0" style={{ borderTop: `1px solid ${C.hairline}`, paddingBottom: wide ? "calc(var(--inset-bottom) + 12px)" : "calc(env(safe-area-inset-bottom) + 12px)" }}>
        {receipt && (
          <div className="py-1">
            <Row label={P.order.subtotal} value={money(receipt.subtotal_money)} muted />
            {receipt.total_discount > 0 && <Row label={P.order.discount} value={`−${money(receipt.total_discount)}`} muted />}
            <Row label={receipt.vat_mode === "inclusive" ? fill(P.order.vatIncluded, { pct: receipt.vat_pct }) : fill(P.order.vat, { pct: receipt.vat_pct })} value={money(receipt.total_tax)} muted />
          </div>
        )}
        {priceError && <p className="text-xs py-1" style={{ color: C.rose }}>{P.errors[priceError] || P.errors.generic}</p>}
        <div className="flex gap-2 pt-1">
          <button onClick={() => setDiscountFor("ticket")} disabled={!order.lines.length} aria-label={P.order.discount}
            className="w-12 rounded-2xl flex items-center justify-center disabled:opacity-40" style={{ background: order.discount ? C.irisWash : "var(--chip-bg)", color: order.discount ? C.iris : C.ink }}>
            <Percent size={17} />
          </button>
          <button onClick={() => setSaveOpen(true)} disabled={!order.lines.length || busy} aria-label={P.order.save}
            className="w-12 rounded-2xl flex items-center justify-center disabled:opacity-40" style={{ background: "var(--chip-bg)", color: C.ink }}>
            <Save size={17} />
          </button>
          <Btn full size="lg" disabled={!receipt || busy} onClick={() => setCharging(true)}>
            {P.order.charge} <span className="data" dir="ltr">{money(receipt?.total_money || 0)}</span>
          </Btn>
        </div>
      </div>
    </div>
  );

  const lineBeingEdited = order.lines.find((l) => l.key === editing);

  return (
    <div className="h-full flex min-h-0">
      <div className="flex-1 min-w-0 relative">
        {grid}
        {flash && (
          <div className="absolute top-3 inset-x-0 flex justify-center pointer-events-none">
            <span className="px-4 py-2 rounded-full text-sm font-semibold shadow-lg" style={{ background: C.ink, color: C.surface }}>{flash}</span>
          </div>
        )}
        {!wide && order.lines.length > 0 && (
          <div className="absolute inset-x-0 bottom-0 p-3 bar-up" style={{ background: `linear-gradient(transparent, ${C.bone} 35%)` }}>
            <button onClick={() => setOrderSheet(true)} className="w-full flex items-center justify-between gap-3 px-5 py-4 rounded-2xl font-bold shadow-xl"
              style={{ background: C.iris, color: "#fff" }}>
              <span className="flex items-center gap-2"><ChevronUp size={18} />{fill(P.order.items, { n: count })}</span>
              <span className="data" dir="ltr">{money(receipt?.total_money || 0)}</span>
            </button>
          </div>
        )}
      </div>
      {wide && <aside className="w-[380px] shrink-0 min-h-0" style={{ borderInlineStart: `1px solid ${C.hairline}`, background: "var(--panel-glass)" }}>{panel}</aside>}

      {!wide && orderSheet && (
        <div className={`fixed inset-0 z-40 flex items-end own-insets ${sheetLeaving ? "backdrop-out" : "backdrop-in"}`} style={{ background: C.scrim }} onClick={() => closeOrderSheet()}>
          <div className={`w-full max-h-[90dvh] rounded-t-3xl overflow-hidden flex flex-col ${sheetLeaving ? "sheet-out" : "sheet-in"}`} style={{ background: C.surface }} onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mt-2 w-10 h-1 rounded-full shrink-0" style={{ background: C.hairline }} />
            <div className="flex items-center justify-between px-4 pt-2 shrink-0">
              <span className="display font-bold text-lg">{P.order.title}</span>
              <button onClick={() => closeOrderSheet()} className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "var(--chip-bg)" }}><X size={16} /></button>
            </div>
            {panel}
          </div>
        </div>
      )}

      {picking && (
        <Sheet title={picking.item.name} onClose={() => setPicking(null)}
          footer={<Btn full size="lg" onClick={() => { add(picking.item, picking.chosen, picking.qty, picking.variantId); setPicking(null); }}>
            {P.sell.add} <span className="data" dir="ltr">{money(((sellable(picking.item).find((v) => v.id === picking.variantId)?.price ?? picking.item.price) + picking.chosen.reduce((s, id) => s + (picking.item.addons.find((a) => a.id === id)?.price || 0), 0)) * picking.qty)}</span>
          </Btn>}>
          {sellable(picking.item).length > 1 && (
            <div className="mb-4">
              <span className="block text-xs font-semibold mb-2" style={{ color: C.slate }}>{P.variants.choose}</span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {sellable(picking.item).map((v) => {
                  const on = v.id === picking.variantId;
                  return (
                    <button key={v.id} onClick={() => setPicking((p) => ({ ...p, variantId: v.id }))}
                      className="min-w-0 flex flex-col items-start px-3.5 py-3 rounded-2xl text-start"
                      style={{ background: on ? C.irisWash : "var(--chip-bg)", color: on ? C.iris : C.ink, border: `1.5px solid ${on ? C.iris : "transparent"}` }}>
                      <span className="text-sm font-bold truncate max-w-full">{v.name || P.variants.regular}</span>
                      <span className="data text-xs font-semibold" dir="ltr">{money(v.price)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            {picking.item.addons.map((a) => {
              const on = picking.chosen.includes(a.id);
              return (
                <button key={a.id} onClick={() => setPicking((p) => ({ ...p, chosen: on ? p.chosen.filter((x) => x !== a.id) : [...p.chosen, a.id] }))}
                  className="w-full flex items-center justify-between px-4 py-3.5 rounded-2xl text-sm font-semibold"
                  style={{ background: on ? C.irisWash : "var(--chip-bg)", color: on ? C.iris : C.ink, border: `1px solid ${on ? C.iris : "transparent"}` }}>
                  <span>{a.name}</span><span className="data" dir="ltr">+{money(a.price)}</span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-center gap-4 mt-4" dir="ltr">
            <button onClick={() => setPicking((p) => ({ ...p, qty: Math.max(1, p.qty - 1) }))} className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: "var(--chip-bg)" }}><Minus size={16} /></button>
            <span className="data text-2xl font-bold w-10 text-center">{picking.qty}</span>
            <button onClick={() => setPicking((p) => ({ ...p, qty: Math.min(999, p.qty + 1) }))} className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: "var(--chip-bg)" }}><Plus size={16} /></button>
          </div>
        </Sheet>
      )}

      {lineBeingEdited && (
        <LineEditor line={lineBeingEdited} item={byId.get(lineBeingEdited.itemId)} P={P}
          onClose={() => setEditing(null)}
          onChange={(patch) => setLine(lineBeingEdited.key, patch)}
          onRemove={() => { removeLine(lineBeingEdited.key); setEditing(null); }}
          onDiscount={() => setDiscountFor(lineBeingEdited.key)} />
      )}

      {discountFor && (
        <DiscountSheet P={P} presets={catalogue.discounts || []} canCustom={can.customDiscount}
          current={discountFor === "ticket" ? order.discount : order.lines.find((l) => l.key === discountFor)?.discount}
          onClose={() => setDiscountFor(null)}
          onPick={(d) => {
            if (discountFor === "ticket") setOrder((o) => ({ ...o, discount: d }));
            else setLine(discountFor, { discount: d });
            setDiscountFor(null);
          }} />
      )}

      {customerOpen && (
        <CustomerPicker token={token} customers={customers} onChanged={onCustomersChanged} selected={order.customerId}
          onPick={(id) => { setOrder((o) => ({ ...o, customerId: id })); setCustomerOpen(false); }}
          onClose={() => setCustomerOpen(false)} />
      )}

      {saveOpen && (
        <Sheet title={P.order.saveTitle} onClose={() => setSaveOpen(false)}
          footer={<Btn full size="lg" disabled={busy} onClick={async () => { await onSaveTicket(); setSaveOpen(false); setOrderSheet(false); }}>{P.order.saveConfirm}</Btn>}>
          <p className="text-sm mb-4" style={{ color: C.slate }}>{P.order.saveLead}</p>
          <Field label={P.order.ticketName} value={order.ticketName} onChange={(v) => setOrder((o) => ({ ...o, ticketName: v.slice(0, 40) }))} placeholder={P.order.ticketNameHint} autoFocus />
          {order.orderType === "dine_in" && (
            <Field label={P.order.table} value={order.table} onChange={(v) => setOrder((o) => ({ ...o, table: v.slice(0, 10) }))} />
          )}
        </Sheet>
      )}

      {charging && receipt && (
        <Charge token={token} order={order} catalogue={catalogue} preview={receipt} customer={customer} branchId={branchId}
          onClose={() => setCharging(false)}
          onDone={(sold) => { setCharging(false); setOrderSheet(false); onSold(sold); }} />
      )}
    </div>
  );
}

function LineEditor({ line, item, P, onClose, onChange, onRemove, onDiscount }) {
  const C = useC();
  return (
    <Sheet title={item?.name || ""} onClose={onClose}
      footer={<div className="flex gap-2"><Btn kind="danger" onClick={onRemove}><Trash2 size={16} />{P.order.remove}</Btn><Btn full onClick={onClose}>{P.common.done}</Btn></div>}>
      <div className="flex items-center justify-center gap-5 my-3" dir="ltr">
        <button onClick={() => onChange({ qty: Math.max(1, line.qty - 1) })} className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "var(--chip-bg)" }}><Minus size={18} /></button>
        <span className="data text-3xl font-bold w-14 text-center">{line.qty}</span>
        <button onClick={() => onChange({ qty: Math.min(999, line.qty + 1) })} className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "var(--chip-bg)" }}><Plus size={18} /></button>
      </div>
      <label className="block mb-3">
        <span className="flex items-center gap-1.5 text-xs font-semibold mb-1.5" style={{ color: C.slate }}><StickyNote size={13} />{P.order.note}</span>
        <input value={line.note} onChange={(e) => onChange({ note: e.target.value.slice(0, 120) })} placeholder={P.order.noteHint}
          className="w-full px-3.5 py-3 rounded-xl text-base outline-none" style={{ background: "var(--chip-bg)", color: C.ink }} />
      </label>
      <button onClick={onDiscount} className="w-full flex items-center justify-between px-4 py-3.5 rounded-2xl text-sm font-semibold"
        style={{ background: "var(--chip-bg)", color: line.discount ? C.mint : C.ink }}>
        <span className="flex items-center gap-2"><Tag size={15} />{P.order.lineDiscount}</span>
        <span>{line.discount ? (line.discount.type === "pct" ? `${line.discount.value}%` : money(line.discount.value)) : P.order.none}</span>
      </button>
    </Sheet>
  );
}

function DiscountSheet({ P, presets, canCustom, current, onClose, onPick }) {
  const C = useC();
  const [type, setType] = useState("pct");
  const [value, setValue] = useState("");
  return (
    <Sheet title={P.order.discount} onClose={onClose}>
      <div className="space-y-1.5 mb-4">
        {presets.map((d) => (
          <button key={d.id} onClick={() => onPick({ id: d.id })} disabled={d.restricted && !canCustom}
            className="w-full flex items-center justify-between px-4 py-3.5 rounded-2xl text-sm font-semibold disabled:opacity-40"
            style={{ background: current?.id === d.id ? C.irisWash : "var(--chip-bg)", color: C.ink }}>
            <span>{d.name}</span><span className="data" dir="ltr">{d.type === "pct" ? `${d.value}%` : money(d.value)}</span>
          </button>
        ))}
        {!presets.length && <p className="text-sm" style={{ color: C.slate }}>{P.order.noPresets}</p>}
      </div>
      {canCustom && (
        <div className="space-y-3">
          <Seg options={[{ value: "pct", label: "%" }, { value: "amount", label: P.order.amount }]} value={type} onChange={setType} />
          <Field value={value} onChange={setValue} inputMode="decimal" dir="ltr" placeholder={type === "pct" ? "10" : "5.00"} />
          <Btn full disabled={!(Number(value) > 0)} onClick={() => onPick({ type, value: Number(value) })}>{P.order.applyDiscount}</Btn>
        </div>
      )}
      {current && <Btn full kind="ghost" className="mt-3" onClick={() => onPick(null)}>{P.order.removeDiscount}</Btn>}
    </Sheet>
  );
}
