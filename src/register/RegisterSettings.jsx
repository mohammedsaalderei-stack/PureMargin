/* Setting the register up.

   Printers belong to this device and are saved on it. Everything else —
   payment types, discounts, the receipt, VAT, loyalty, shifts, products and
   PINs — belongs to the business, is saved on the server, and is shown only
   to somebody allowed to change it. */

import { useEffect, useState } from "react";
import { Printer, CreditCard, Percent, ReceiptText, SlidersHorizontal, Package, KeyRound, ChevronRight, Plus, Trash2, Radar, Check, ImagePlus } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill } from "../i18n.jsx";
import { Btn, Sheet, Field, Seg, Toggle, money } from "./ui.jsx";
import { call, RegisterError } from "./api.js";
import { loadPrinters, savePrinters, newPrinter, connectionsAvailable, discover, discoverBluetooth, pickBluetoothAccessory, pairDevice, testPrint } from "../print/printers.js";
import { isNativePlatform } from "../platform.js";
import { shrinkImage, pictureSrc } from "./itemImage.js";

export default function RegisterSettings({ token, catalogue, onChanged, printCtx }) {
  const C = useC();
  const { t } = useLang();
  const P = t.pos;
  const can = catalogue.can || {};
  const [open, setOpen] = useState(null);
  const sections = [
    { id: "printers", icon: Printer, show: true },
    { id: "payments", icon: CreditCard, show: can.manageSettings },
    { id: "discounts", icon: Percent, show: can.manageSettings },
    { id: "receipt", icon: ReceiptText, show: can.manageSettings },
    { id: "options", icon: SlidersHorizontal, show: can.manageSettings },
    { id: "items", icon: Package, show: can.manageItems },
    { id: "pins", icon: KeyRound, show: can.manageStaff },
  ].filter((s) => s.show);

  const close = (changed) => { setOpen(null); if (changed) onChanged(); };

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="max-w-2xl mx-auto">
        <h2 className="display font-bold text-xl mb-4">{P.views.settings}</h2>
        <div className="rounded-3xl overflow-hidden" style={{ background: C.surface, border: `1px solid ${C.hairline}` }}>
          {sections.map(({ id, icon: Icon }) => (
            <button key={id} onClick={() => setOpen(id)} className="w-full flex items-center gap-3 px-5 py-4 text-start" style={{ borderBottom: `1px solid ${C.hairline}` }}>
              <span className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0" style={{ background: C.irisWash, color: C.iris }}><Icon size={18} /></span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-bold">{P.settings[id].title}</span>
                <span className="block text-xs truncate" style={{ color: C.slate }}>{P.settings[id].lead}</span>
              </span>
              <ChevronRight size={17} className="flip-rtl" style={{ color: C.slate }} />
            </button>
          ))}
        </div>
      </div>
      {open === "printers" && <Printers P={P} catalogue={catalogue} printCtx={printCtx} onClose={() => close(false)} />}
      {open === "payments" && <PaymentTypes token={token} P={P} initial={catalogue.paymentTypes} onClose={close} />}
      {open === "discounts" && <Discounts token={token} P={P} initial={catalogue.discounts} onClose={close} />}
      {open === "receipt" && <ReceiptText_ token={token} P={P} initial={catalogue.receipt} onClose={close} />}
      {open === "options" && <Options token={token} P={P} catalogue={catalogue} onClose={close} />}
      {open === "items" && <Items token={token} P={P} catalogue={catalogue} onClose={close} />}
      {open === "pins" && <Pins token={token} P={P} onClose={close} />}
    </div>
  );
}

function useSave(token, P) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (what, body, method = "PUT") => {
    setBusy(true);
    setError("");
    try { return await call(token, what, { method, body }); }
    catch (err) { setError(err instanceof RegisterError ? (P.settings.errors[err.body?.error] || P.errors.generic) : P.errors.network); return null; }
    finally { setBusy(false); }
  };
  return { busy, error, run };
}

/* ── Printers (this device) ── */

function Printers({ P, catalogue, printCtx, onClose }) {
  const C = useC();
  const [list, setList] = useState(loadPrinters());
  const [editing, setEditing] = useState(null);
  const save = (next) => { setList(savePrinters(next)); };
  return (
    <Sheet title={P.settings.printers.title} onClose={onClose} wide
      footer={<Btn full onClick={() => setEditing(newPrinter())}><Plus size={16} />{P.settings.printers.add}</Btn>}>
      <p className="text-sm mb-3" style={{ color: C.slate }}>{P.settings.printers.device}</p>
      {!list.length && <p className="text-sm py-4" style={{ color: C.slate }}>{P.settings.printers.none}</p>}
      {list.map((p) => (
        <button key={p.id} onClick={() => setEditing(p)} className="w-full flex items-center justify-between gap-3 px-4 py-3.5 rounded-2xl mb-2 text-start" style={{ background: "var(--chip-bg)" }}>
          <span className="min-w-0">
            <span className="block text-sm font-bold truncate">{p.name || P.settings.printers.unnamed}</span>
            <span className="block text-xs" style={{ color: C.slate }}>{P.settings.printers.roles[p.role]} · {P.settings.printers.connections[p.connection]}{p.host ? ` · ${p.host}` : ""}{p.btName ? ` · ${p.btName}` : ""} · {p.paper} mm</span>
          </span>
          <ChevronRight size={16} className="flip-rtl" style={{ color: C.slate }} />
        </button>
      ))}
      {editing && (
        <PrinterForm P={P} printer={editing} categories={[...new Set((catalogue.items || []).map((i) => i.category).filter(Boolean))]} printCtx={printCtx}
          onClose={() => setEditing(null)}
          onRemove={() => { save(list.filter((x) => x.id !== editing.id)); setEditing(null); }}
          onSave={(p) => { save(list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p]); setEditing(null); }} />
      )}
    </Sheet>
  );
}

function PrinterForm({ P, printer, categories, printCtx, onClose, onSave, onRemove }) {
  const C = useC();
  const S = P.settings.printers;
  const [p, setP] = useState(printer);
  const [found, setFound] = useState(null);
  const [status, setStatus] = useState("");
  const avail = connectionsAvailable();
  const conns = Object.keys(avail).filter((k) => avail[k]);
  const set = (patch) => setP((x) => ({ ...x, ...patch }));
  const test = async () => {
    setStatus(S.testing);
    try { await testPrint(p, printCtx); setStatus(S.testOk); }
    catch (err) { setStatus(fill(S.testFailed, { error: String(err?.message || err) })); }
  };
  return (
    <Sheet title={printer.name || S.add} onClose={onClose}
      footer={<div className="flex gap-2"><Btn kind="danger" onClick={onRemove}><Trash2 size={16} /></Btn><Btn kind="ghost" onClick={test}>{S.test}</Btn><Btn full onClick={() => onSave(p)}>{P.common.save}</Btn></div>}>
      <Field label={S.name} value={p.name} onChange={(v) => set({ name: v })} placeholder={S.nameHint} />
      <span className="block text-xs font-semibold mb-1.5" style={{ color: C.slate }}>{S.role}</span>
      <div className="mb-3"><Seg options={[{ value: "receipt", label: S.roles.receipt }, { value: "kitchen", label: S.roles.kitchen }]} value={p.role} onChange={(v) => set({ role: v })} /></div>
      <span className="block text-xs font-semibold mb-1.5" style={{ color: C.slate }}>{S.connection}</span>
      <div className="flex flex-wrap gap-2 mb-3">
        {conns.map((c) => (
          <button key={c} onClick={() => set({ connection: c })} className="px-3.5 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: p.connection === c ? C.ink : "var(--chip-bg)", color: p.connection === c ? C.surface : C.ink }}>{S.connections[c]}</button>
        ))}
      </div>
      <p className="text-xs mb-3" style={{ color: C.slate }}>{S.connectionHelp[p.connection]}</p>
      {p.connection === "network" && (
        <>
          <Btn kind="ghost" full className="mb-3" onClick={async () => { setFound([]); setFound(await discover()); }}><Radar size={16} />{S.find}</Btn>
          {found && (found.length ? found.map((f) => (
            <button key={f.service} onClick={() => set({ service: f.service, host: "", name: p.name || f.name })} className="w-full flex items-center justify-between px-4 py-3 rounded-2xl mb-2 text-sm font-semibold"
              style={{ background: p.service === f.service ? C.irisWash : "var(--chip-bg)" }}>{f.name}{p.service === f.service && <Check size={15} />}</button>
          )) : <p className="text-xs mb-3" style={{ color: C.slate }}>{S.findNone}</p>)}
          <Field label={S.host} value={p.host} onChange={(v) => set({ host: v.trim(), service: "" })} placeholder="192.168.1.50" inputMode="decimal" dir="ltr" />
          <Field label={S.port} value={String(p.port)} onChange={(v) => set({ port: Number(v) || 9100 })} inputMode="numeric" dir="ltr" />
        </>
      )}
      {p.connection === "bluetooth" && isNativePlatform() && (
        <>
          <Btn kind="ghost" full className="mb-2" onClick={async () => {
            setFound([]);
            try { setFound(await discoverBluetooth()); } catch (err) { setFound([]); setStatus(fill(S.btFailed, { error: String(err?.message || err) })); }
          }}><Radar size={16} />{S.btFind}</Btn>
          <button className="w-full text-xs font-semibold mb-3 underline" style={{ color: C.slate }}
            onClick={async () => { try { const list = await pickBluetoothAccessory(); if (list.length) setFound(list); } catch { /* cancelled */ } }}>{S.btPairMfi}</button>
          {found && (found.length ? found.map((f) => (
            <button key={f.id} onClick={() => set({ btId: f.id, btKind: f.kind, btProtocol: f.protocol || "", btName: f.name, name: p.name || f.name })}
              className="w-full flex items-center justify-between px-4 py-3 rounded-2xl mb-2 text-sm font-semibold"
              style={{ background: p.btId === f.id ? C.irisWash : "var(--chip-bg)" }}>
              <span>{f.name}{f.kind === "mfi" && <span className="ms-2 text-[10px] font-bold" style={{ color: C.slate }}>MFi</span>}</span>
              {p.btId === f.id && <Check size={15} />}
            </button>
          )) : <p className="text-xs mb-3" style={{ color: C.slate }}>{S.btNone}</p>)}
          {p.btId && !found && <p className="text-xs mb-3" style={{ color: C.slate }}>{fill(S.btChosen, { name: p.btName || p.btId })}</p>}
        </>
      )}
      {p.connection === "bluetooth" && !isNativePlatform() && (
        <Btn kind="ghost" full className="mb-3" onClick={async () => { try { setP(await pairDevice(p)); setStatus(S.paired); } catch { setStatus(S.pairFailed); } }}>{S.pair}</Btn>
      )}
      {(p.connection === "usb" || p.connection === "serial") && (
        <Btn kind="ghost" full className="mb-3" onClick={async () => { try { setP(await pairDevice(p)); setStatus(S.paired); } catch { setStatus(S.pairFailed); } }}>{S.pair}</Btn>
      )}
      <span className="block text-xs font-semibold mb-1.5" style={{ color: C.slate }}>{S.paper}</span>
      <div className="mb-3"><Seg options={[{ value: 80, label: "80 mm" }, { value: 58, label: "58 mm" }]} value={p.paper} onChange={(v) => set({ paper: v })} /></div>
      {p.role === "receipt" ? (
        <>
          <Toggle label={S.autoPrint} value={p.autoPrint} onChange={(v) => set({ autoPrint: v })} />
          <Toggle label={S.drawer} hint={S.drawerHint} value={p.drawer} onChange={(v) => set({ drawer: v })} />
        </>
      ) : (
        <>
          <span className="block text-xs font-semibold mb-1.5" style={{ color: C.slate }}>{S.categories}</span>
          <div className="flex flex-wrap gap-2 mb-2">
            {categories.map((c) => {
              const on = p.categories.includes(c);
              return <button key={c} onClick={() => set({ categories: on ? p.categories.filter((x) => x !== c) : [...p.categories, c] })} className="px-3 py-2 rounded-xl text-sm font-semibold"
                style={{ background: on ? C.irisWash : "var(--chip-bg)", color: on ? C.iris : C.ink }}>{c}</button>;
            })}
          </div>
          <p className="text-xs mb-2" style={{ color: C.slate }}>{S.categoriesHint}</p>
        </>
      )}
      {status && <p className="text-sm mt-2 font-semibold" style={{ color: C.iris }}>{status}</p>}
    </Sheet>
  );
}

/* ── Business settings ── */

function ListEditor({ rows, setRows, render, blank, addLabel }) {
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="flex-1">{render(r, (patch) => setRows(rows.map((x, j) => (j === i ? { ...x, ...patch } : x))))}</div>
          <button onClick={() => setRows(rows.filter((_, j) => j !== i))} className="mt-3 p-2 rounded-xl" style={{ color: "#F43F5E" }}><Trash2 size={16} /></button>
        </div>
      ))}
      <Btn kind="ghost" full onClick={() => setRows([...rows, blank()])}><Plus size={16} />{addLabel}</Btn>
    </div>
  );
}

function PaymentTypes({ token, P, initial, onClose }) {
  const S = P.settings.payments;
  const [rows, setRows] = useState(initial || []);
  const { busy, error, run } = useSave(token, P);
  return (
    <Sheet title={S.title} onClose={() => onClose(false)}
      footer={<div>{error && <p className="text-sm mb-2" style={{ color: "#F43F5E" }}>{error}</p>}<Btn full disabled={busy} onClick={async () => { if (await run("settings", { section: "paymentTypes", value: rows })) onClose(true); }}>{P.common.save}</Btn></div>}>
      <ListEditor rows={rows} setRows={setRows} addLabel={S.add} blank={() => ({ name: "", kind: "other" })}
        render={(r, set) => (
          <div className="space-y-2">
            <Field value={r.name} onChange={(v) => set({ name: v })} placeholder={S.name} />
            <Seg options={["cash", "card", "other"].map((k) => ({ value: k, label: S.kinds[k] }))} value={r.kind} onChange={(v) => set({ kind: v })} />
          </div>
        )} />
    </Sheet>
  );
}

function Discounts({ token, P, initial, onClose }) {
  const S = P.settings.discounts;
  const [rows, setRows] = useState(initial || []);
  const { busy, error, run } = useSave(token, P);
  return (
    <Sheet title={S.title} onClose={() => onClose(false)}
      footer={<div>{error && <p className="text-sm mb-2" style={{ color: "#F43F5E" }}>{error}</p>}<Btn full disabled={busy} onClick={async () => { if (await run("settings", { section: "discounts", value: rows.map((r) => ({ ...r, value: Number(r.value) })) })) onClose(true); }}>{P.common.save}</Btn></div>}>
      <ListEditor rows={rows} setRows={setRows} addLabel={S.add} blank={() => ({ name: "", type: "pct", value: "", restricted: false })}
        render={(r, set) => (
          <div className="space-y-2">
            <div className="flex gap-2">
              <div className="flex-1"><Field value={r.name} onChange={(v) => set({ name: v })} placeholder={S.name} /></div>
              <div className="w-24"><Field value={String(r.value ?? "")} onChange={(v) => set({ value: v })} inputMode="decimal" dir="ltr" placeholder={r.type === "pct" ? "%" : "0.00"} /></div>
            </div>
            <Seg options={[{ value: "pct", label: S.pct }, { value: "amount", label: S.amount }]} value={r.type} onChange={(v) => set({ type: v })} />
            <Toggle label={S.restricted} hint={S.restrictedHint} value={r.restricted} onChange={(v) => set({ restricted: v })} />
          </div>
        )} />
    </Sheet>
  );
}

function ReceiptText_({ token, P, initial, onClose }) {
  const S = P.settings.receipt;
  const [r, setR] = useState({ business: "", address: "", phone: "", trn: "", header: "", footer: "", ...initial });
  const { busy, error, run } = useSave(token, P);
  return (
    <Sheet title={S.title} onClose={() => onClose(false)}
      footer={<div>{error && <p className="text-sm mb-2" style={{ color: "#F43F5E" }}>{error}</p>}<Btn full disabled={busy} onClick={async () => { if (await run("settings", { section: "receipt", value: r })) onClose(true); }}>{P.common.save}</Btn></div>}>
      <Field label={S.business} value={r.business} onChange={(v) => setR({ ...r, business: v })} />
      <Field label={S.address} value={r.address} onChange={(v) => setR({ ...r, address: v })} />
      <Field label={S.phone} value={r.phone} onChange={(v) => setR({ ...r, phone: v })} inputMode="tel" dir="ltr" />
      <Field label={S.trn} value={r.trn} onChange={(v) => setR({ ...r, trn: v })} inputMode="numeric" dir="ltr" hint={S.trnHint} />
      <Field label={S.header} value={r.header} onChange={(v) => setR({ ...r, header: v })} />
      <Field label={S.footer} value={r.footer} onChange={(v) => setR({ ...r, footer: v })} placeholder={S.footerHint} />
    </Sheet>
  );
}

function Options({ token, P, catalogue, onClose }) {
  const S = P.settings.options;
  const [o, setO] = useState({ vatMode: catalogue.vatMode, loyaltyPct: String(catalogue.loyaltyPct || 0), useShifts: catalogue.useShifts, vatPct: String(catalogue.vatPct) });
  const { busy, error, run } = useSave(token, P);
  const save = async () => {
    const a = await run("settings", { section: "options", value: { vatMode: o.vatMode, loyaltyPct: Number(o.loyaltyPct) || 0, useShifts: o.useShifts } });
    const b = a && (Number(o.vatPct) !== catalogue.vatPct ? await run("vat", { vatPct: Number(o.vatPct) }) : true);
    if (a && b) onClose(true);
  };
  return (
    <Sheet title={S.title} onClose={() => onClose(false)}
      footer={<div>{error && <p className="text-sm mb-2" style={{ color: "#F43F5E" }}>{error}</p>}<Btn full disabled={busy} onClick={save}>{P.common.save}</Btn></div>}>
      <Field label={S.vatPct} value={o.vatPct} onChange={(v) => setO({ ...o, vatPct: v })} inputMode="decimal" dir="ltr" />
      <div className="mb-3"><Seg options={[{ value: "exclusive", label: S.vatExclusive }, { value: "inclusive", label: S.vatInclusive }]} value={o.vatMode} onChange={(v) => setO({ ...o, vatMode: v })} /></div>
      <Field label={S.loyalty} value={o.loyaltyPct} onChange={(v) => setO({ ...o, loyaltyPct: v })} inputMode="decimal" dir="ltr" hint={S.loyaltyHint} />
      <Toggle label={S.shifts} hint={S.shiftsHint} value={o.useShifts} onChange={(v) => setO({ ...o, useShifts: v })} />
    </Sheet>
  );
}

/* ── What the register sells ── */

function Items({ token, P, catalogue, onClose }) {
  const C = useC();
  const S = P.settings.items;
  const V = P.variants;
  const [editing, setEditing] = useState(null);
  const [stockItems, setStockItems] = useState([]);
  const [variantError, setVariantError] = useState("");
  const { busy, error, run } = useSave(token, P);
  const items = catalogue.items || [];
  useEffect(() => {
    call(token, "stockitems").then((out) => setStockItems(out.items || [])).catch(() => {});
  }, [token]);

  const open = (i) => {
    setVariantError("");
    setEditing({
      ...i, price: i.price ?? "", cost: i.cost ?? "",
      variantRows: i.variantsFromRecipes ? [] : (i.variants || []).map((v) => ({ ...v, price: String(v.price), scale: String(v.scale ?? 1) })),
      stockId: i.stock?.ingredientId || "", stockQty: String(i.stock?.qty ?? 1), stockUnit: i.stock?.unit || "",
    });
  };
  const save = async () => {
    const e = editing;
    setVariantError("");
    const stockItem = stockItems.find((x) => x.id === e.stockId);
    const out = e.kind === "recipe"
      ? await run("item", { itemId: e.id, barcode: e.barcode, sku: e.sku, color: e.color, hidden: e.hidden })
      : await run("product", {
        id: e.id, name: e.name, price: Number(e.price), cost: e.cost === "" ? null : e.cost, category: e.category,
        barcode: e.barcode, sku: e.sku, color: e.color, hidden: e.hidden,
        stock: stockItem ? { ingredientId: stockItem.id, qty: Number(e.stockQty), unit: e.stockUnit || stockItem.stockUnit } : null,
      });
    if (!out) return;
    /* The photo, once the item has an id to hang it on. */
    const itemId = e.kind === "recipe" ? e.id : out.id;
    try {
      if (e.newImage) await call(token, "image", { method: "PUT", body: { itemId, image: e.newImage } });
      else if (e.dropImage && e.image) await call(token, "image", { method: "DELETE", query: { id: itemId } });
    } catch {
      setVariantError(V.photoFailed);
      return;
    }
    if (!e.variantsFromRecipes) {
      try {
        await call(token, "variants", { method: "PUT", body: {
          itemId: e.kind === "recipe" ? e.id : out.id,
          variants: e.variantRows.filter((v) => v.name.trim() || String(v.price).trim()).map((v) => ({ id: v.id, name: v.name, price: Number(v.price), scale: v.scale === "" ? 1 : Number(v.scale), barcode: v.barcode || "" })),
        } });
      } catch (err) {
        setVariantError(V.errors[err?.body?.error] || P.errors.generic);
        return;
      }
    }
    setEditing(null);
    onClose(true);
  };
  const COLORS = ["", "#7C3AED", "#0891B2", "#059669", "#D97706", "#E11D48", "#2563EB", "#64748B"];
  return (
    <Sheet title={S.title} onClose={() => onClose(false)} wide
      footer={<Btn full onClick={() => setEditing({ kind: "product", name: "", price: "", cost: "", category: "", barcode: "", sku: "", color: "", hidden: false })}><Plus size={16} />{S.addProduct}</Btn>}>
      <p className="text-sm mb-3" style={{ color: C.slate }}>{S.lead}</p>
      {items.map((i) => (
        <button key={i.id} onClick={() => open(i)} className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl mb-1.5 text-start" style={{ background: "var(--chip-bg)", opacity: i.hidden ? 0.5 : 1 }}>
          <span className="flex items-center gap-2 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: i.color || C.hairline }} />
            <span className="min-w-0">
              <span className="block text-sm font-semibold truncate">{i.name}</span>
              <span className="block text-xs" style={{ color: C.slate }}>{i.kind === "recipe" ? S.recipe : S.product}{i.category ? ` · ${i.category}` : ""}{i.variants?.length ? ` · ${i.variants.length} ${V.title}` : ""}{i.barcode ? ` · ${i.barcode}` : ""}</span>
            </span>
          </span>
          <span className="data text-sm font-bold" dir="ltr">{i.priced ? money(i.price) : "—"}</span>
        </button>
      ))}
      {editing && (
        <Sheet title={editing.name || S.addProduct} onClose={() => setEditing(null)}
          footer={<div>{(error || variantError) && <p className="text-sm mb-2" style={{ color: "#F43F5E" }}>{variantError || (P.variants.errors[error] || error)}</p>}<Btn full disabled={busy} onClick={save}>{P.common.save}</Btn></div>}>
          {/* The photo on the Sell screen tile. Shrunk to a 480-pixel square
              here before it is sent (`itemImage.js`). */}
          <div className="flex items-center gap-3 mb-4">
            <div className="w-20 h-20 rounded-2xl overflow-hidden shrink-0 flex items-center justify-center" style={{ background: "var(--chip-bg)", border: `1px solid ${C.hairline}` }}>
              {editing.newImage || (editing.image && !editing.dropImage)
                ? <img src={editing.newImage || pictureSrc(editing.image)} alt="" className="w-full h-full object-cover" />
                : <ImagePlus size={22} style={{ color: C.slate }} />}
            </div>
            <div className="flex flex-col items-start gap-1.5 min-w-0">
              <label className="px-3.5 py-2 rounded-xl text-sm font-semibold cursor-pointer" style={{ background: "var(--chip-bg)", color: C.ink }}>
                {editing.newImage || (editing.image && !editing.dropImage) ? V.changePhoto : V.addPhoto}
                <input type="file" accept="image/*" className="hidden" onChange={async (ev) => {
                  const file = ev.target.files?.[0];
                  ev.target.value = "";
                  if (!file) return;
                  try { setEditing((x) => ({ ...x, newImage: null })); const data = await shrinkImage(file); setEditing((x) => ({ ...x, newImage: data, dropImage: false })); setVariantError(""); }
                  catch { setVariantError(V.photoFailed); }
                }} />
              </label>
              {(editing.newImage || (editing.image && !editing.dropImage)) && (
                <button onClick={() => setEditing({ ...editing, newImage: null, dropImage: true })} className="text-xs font-semibold" style={{ color: C.rose }}>{V.removePhoto}</button>
              )}
            </div>
          </div>
          {editing.kind === "product" ? (
            <>
              <Field label={S.name} value={editing.name} onChange={(v) => setEditing({ ...editing, name: v })} />
              <div className="flex gap-2">
                <div className="flex-1"><Field label={S.price} value={String(editing.price)} onChange={(v) => setEditing({ ...editing, price: v })} inputMode="decimal" dir="ltr" /></div>
                <div className="flex-1"><Field label={S.cost} value={String(editing.cost)} onChange={(v) => setEditing({ ...editing, cost: v })} inputMode="decimal" dir="ltr" /></div>
              </div>
              <Field label={S.category} value={editing.category} onChange={(v) => setEditing({ ...editing, category: v })} />
            </>
          ) : <p className="text-sm mb-3" style={{ color: C.slate }}>{S.recipeHint}</p>}
          <div className="flex gap-2">
            <div className="flex-1"><Field label={S.barcode} value={editing.barcode} onChange={(v) => setEditing({ ...editing, barcode: v })} dir="ltr" /></div>
            <div className="flex-1"><Field label={S.sku} value={editing.sku} onChange={(v) => setEditing({ ...editing, sku: v })} dir="ltr" /></div>
          </div>
          <span className="block text-xs font-semibold mb-1.5" style={{ color: C.slate }}>{S.color}</span>
          <div className="flex gap-2 mb-3">
            {COLORS.map((c) => (
              <button key={c || "none"} onClick={() => setEditing({ ...editing, color: c })} className="w-9 h-9 rounded-full flex items-center justify-center"
                style={{ background: c || "var(--chip-bg)", border: `2px solid ${editing.color === c ? C.ink : "transparent"}` }}>{!c && "∅"}</button>
            ))}
          </div>
          <Toggle label={S.hidden} hint={S.hiddenHint} value={editing.hidden} onChange={(v) => setEditing({ ...editing, hidden: v })} />

          {/* Sizes or flavours. A dish whose sizes are recipes of their own
              shows where they come from instead of a list to edit here. */}
          <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${C.hairline}` }}>
            <span className="block text-sm font-bold mb-1">{V.title}</span>
            {editing.variantsFromRecipes ? (
              <p className="text-xs" style={{ color: C.slate }}>{fill(V.fromRecipes, { name: editing.name })} {editing.variants.map((v) => v.name || V.regular).join(" · ")}</p>
            ) : (
              <>
                <p className="text-xs mb-3" style={{ color: C.slate }}>{V.lead}</p>
                <ListEditor rows={editing.variantRows} setRows={(rows) => setEditing({ ...editing, variantRows: rows })}
                  blank={() => ({ name: "", price: "", scale: "1", barcode: "" })} addLabel={V.add}
                  render={(r, set) => (
                    <div className="grid grid-cols-[1fr_5.5rem_4.5rem] gap-2">
                      <Field label={V.name} value={r.name} onChange={(v) => set({ name: v })} />
                      <Field label={V.price} value={r.price} onChange={(v) => set({ price: v })} inputMode="decimal" dir="ltr" />
                      <Field label={V.scale} value={r.scale} onChange={(v) => set({ scale: v })} inputMode="decimal" dir="ltr" />
                    </div>
                  )} />
              </>
            )}
          </div>

          {/* Trading stock: products bought in and sold as they are. */}
          {editing.kind === "product" && (
            <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${C.hairline}` }}>
              <span className="block text-sm font-bold mb-1">{V.stockTitle}</span>
              <p className="text-xs mb-3" style={{ color: C.slate }}>{V.stockLead}</p>
              <select value={editing.stockId} onChange={(e) => {
                const it = stockItems.find((x) => x.id === e.target.value);
                setEditing({ ...editing, stockId: e.target.value, stockUnit: it?.stockUnit || "" });
              }} className="w-full px-3.5 py-3 rounded-xl text-base outline-none mb-3"
                style={{ background: "var(--chip-bg)", color: C.ink, border: `1px solid ${C.hairline}` }}>
                <option value="">{V.stockNone}</option>
                {stockItems.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
              {editing.stockId && (
                <div className="flex gap-2">
                  <div className="flex-1"><Field label={V.stockQty} value={editing.stockQty} onChange={(v) => setEditing({ ...editing, stockQty: v })} inputMode="decimal" dir="ltr" /></div>
                  <label className="flex-1 block mb-3">
                    <span className="block text-xs font-semibold mb-1.5" style={{ color: C.slate }}>{V.stockUnit}</span>
                    <select value={editing.stockUnit} onChange={(e) => setEditing({ ...editing, stockUnit: e.target.value })}
                      className="w-full px-3.5 py-3 rounded-xl text-base outline-none" dir="ltr"
                      style={{ background: "var(--chip-bg)", color: C.ink, border: `1px solid ${C.hairline}` }}>
                      {(stockItems.find((x) => x.id === editing.stockId)?.units || []).map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </label>
                </div>
              )}
            </div>
          )}
        </Sheet>
      )}
    </Sheet>
  );
}

/* ── Who has a PIN ── */

function Pins({ token, P, onClose }) {
  const C = useC();
  const S = P.settings.pins;
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const { busy, error, run } = useSave(token, P);
  const load = () => call(token, "pins").then(setData).catch(() => setData({ pins: [], employees: [] }));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <Sheet title={S.title} onClose={() => onClose(false)}><p className="text-sm" style={{ color: C.slate }}>{P.common.loading}</p></Sheet>;
  const pinOf = (id) => data.pins.find((p) => p.employeeId === id);
  return (
    <Sheet title={S.title} onClose={() => onClose(true)}>
      <p className="text-sm mb-3" style={{ color: C.slate }}>{S.lead}</p>
      {!data.employees.length && <p className="text-sm py-3" style={{ color: C.slate }}>{S.noStaff}</p>}
      {data.employees.map((e) => {
        const pin = pinOf(e.id);
        return (
          <button key={e.id} onClick={() => setEditing({ employeeId: e.id, name: e.name, pin: "", role: pin?.role || "cashier", has: Boolean(pin) })}
            className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl mb-1.5 text-start" style={{ background: "var(--chip-bg)" }}>
            <span className="min-w-0">
              <span className="block text-sm font-semibold truncate">{e.name}</span>
              <span className="block text-xs" style={{ color: C.slate }}>{e.title || "—"}</span>
            </span>
            <span className="text-xs font-bold" style={{ color: pin ? C.mint : C.slate }}>{pin ? S.roles[pin.role] : S.noPin}</span>
          </button>
        );
      })}
      {editing && (
        <Sheet title={editing.name} onClose={() => setEditing(null)}
          footer={<div className="space-y-2">
            {error && <p className="text-sm" style={{ color: "#F43F5E" }}>{error}</p>}
            <div className="flex gap-2">
              {editing.has && <Btn kind="danger" onClick={async () => { await call(token, "pins", { method: "DELETE", query: { employeeId: editing.employeeId } }).catch(() => {}); setEditing(null); load(); }}>{S.remove}</Btn>}
              <Btn full disabled={busy || !/^\d{4,6}$/.test(editing.pin)} onClick={async () => { if (await run("pins", { employeeId: editing.employeeId, pin: editing.pin, role: editing.role })) { setEditing(null); load(); } }}>{P.common.save}</Btn>
            </div>
          </div>}>
          <Field label={S.pin} value={editing.pin} onChange={(v) => setEditing({ ...editing, pin: v.replace(/\D/g, "").slice(0, 6) })} inputMode="numeric" dir="ltr" type="password" hint={S.pinHint} autoFocus />
          <Seg options={[{ value: "cashier", label: S.roles.cashier }, { value: "manager", label: S.roles.manager }]} value={editing.role} onChange={(v) => setEditing({ ...editing, role: v })} />
          <p className="text-xs mt-2" style={{ color: C.slate }}>{S.roleHint}</p>
        </Sheet>
      )}
    </Sheet>
  );
}
