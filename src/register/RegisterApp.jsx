/* The register: a till of its own, full screen.

   Opened from the Register portal and closed with the back-office button,
   it has its own navigation — Sell, Tickets, Receipts, Shift, Customers,
   Settings — down the side on a tablet and along the bottom on a phone.

   Three things can stand between a cashier and the grid, in this order:
     1. a PIN, once anybody in the business has one (who is selling?);
     2. an open shift, when the business counts its drawer (with what float?);
     3. nothing else. No POS connection, no setup screen: a business that has
        recipes with prices can sell the moment it opens this.

   It keeps selling without a connection — see `api.js` — and says so in the
   top bar, with the number of sales waiting to be sent. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ShoppingCart, ClipboardList, Receipt, Wallet, Users, Settings, LogOut, Lock, WifiOff, CloudUpload, MoreHorizontal, Printer, Check, ArrowLeftRight } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill, localeFor } from "../i18n.jsx";
import BrandMark from "../BrandMark.jsx";
import { Btn, Sheet, Keypad, keyInto, Empty, Field, money } from "./ui.jsx";
import Sell, { emptyOrder } from "./Sell.jsx";
import Tickets from "./Tickets.jsx";
import Receipts from "./Receipts.jsx";
import Shift from "./Shift.jsx";
import Customers from "./Customers.jsx";
import RegisterSettings from "./RegisterSettings.jsx";
import PinPad from "./PinPad.jsx";
import { loadCatalogue, call, flush, queued, savedOperator, setOperator, savedBranch, saveBranch, RegisterError } from "./api.js";
import { printReceipt, printKitchen, loadPrinters } from "../print/printers.js";

const VIEWS = [
  { id: "sell", icon: ShoppingCart },
  { id: "tickets", icon: ClipboardList },
  { id: "receipts", icon: Receipt },
  { id: "shift", icon: Wallet },
  { id: "customers", icon: Users },
  { id: "settings", icon: Settings },
];

function useWide() {
  const query = "(min-width: 900px)";
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
}

/* What the kitchen has not been sent yet, line by line. */
function kitchenLines(order, items) {
  const byId = new Map(items.map((i) => [i.id, i]));
  return order.lines
    .map((l) => ({ l, item: byId.get(l.itemId), qty: l.qty - (order.printed?.[l.key] || 0) }))
    .filter((x) => x.qty > 0 && x.item)
    .map(({ l, item, qty }) => ({
      key: l.key, qty, name: item.name, category: item.category, note: l.note,
      addons: l.addons.map((a) => item.addons?.find((x) => x.id === a)?.name || a),
    }));
}

export default function RegisterApp({ token, user, business, onExit, onLogout }) {
  const C = useC();
  const { t, lang, rtl } = useLang();
  const P = t.pos;
  const wide = useWide();

  const [catalogue, setCatalogue] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [view, setView] = useState("sell");
  const [branchId, setBranchId] = useState(savedBranch());
  const [operator, setOp] = useState(savedOperator());
  const [order, setOrder] = useState(() => emptyOrder());
  const [customers, setCustomers] = useState([]);
  const [shift, setShift] = useState(undefined);
  const [summary, setSummary] = useState(null);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [waiting, setWaiting] = useState(queued().length);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [notice, setNotice] = useState("");
  const [pricing, setPricing] = useState(null);

  /* A store's own address, phone and tax number replace the business-wide
     ones on its receipts, field by field, so a second branch prints where it
     is rather than where the first one is. */
  const printCtx = useMemo(() => {
    const store = catalogue?.branches?.find((b) => b.id === branchId) || {};
    const own = Object.fromEntries(["address", "phone", "trn"].filter((k) => store[k]).map((k) => [k, store[k]]));
    return {
      labels: P.print, locale: localeFor(lang), rtl,
      settings: { receipt: { business, ...(catalogue?.receipt || {}), ...own } },
    };
  }, [P.print, lang, rtl, business, catalogue?.receipt, catalogue?.branches, branchId]);

  const load = useCallback(async () => {
    try {
      const out = await loadCatalogue(token, user);
      setCatalogue(out);
      setOnline(!out.offline);
      setLoadError("");
      setBranchId((b) => (out.branches?.some((x) => x.id === b) ? b : out.branches?.[0]?.id || "register"));
      if (out.operator) setOp(out.operator);
      else if (!out.offline && out.pinsRequired) { setOp(null); setOperator(null); }
    } catch (err) {
      setLoadError(err instanceof RegisterError && err.status === 403 ? P.errors.forbidden : P.errors.load);
    }
  }, [token, user, P.errors]);

  const loadCustomers = useCallback(async () => {
    try { setCustomers((await call(token, "customers")).customers || []); } catch { /* offline: keep what we had */ }
  }, [token]);

  const loadShift = useCallback(async () => {
    if (!branchId) return;
    try {
      const out = await call(token, "shift", { query: { branchId } });
      setShift(out.shift);
      setSummary(out.summary || null);
    } catch {
      setShift((s) => (s === undefined ? null : s));
    }
  }, [token, branchId]);

  useEffect(() => { load(); loadCustomers(); }, [load, loadCustomers]);
  useEffect(() => { if (branchId) { saveBranch(branchId); loadShift(); } }, [branchId, loadShift, operator]);

  /* Send anything sold offline, now and every half minute. */
  useEffect(() => {
    const send = async () => {
      if (!queued().length) return;
      const out = await flush(token).catch(() => null);
      setWaiting(queued().length);
      if (out?.sent) { setOnline(true); loadShift(); }
    };
    const up = () => { setOnline(true); send(); };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    const timer = setInterval(send, 30000);
    send();
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); clearInterval(timer); };
  }, [token, loadShift]);

  const say = (text) => { setNotice(text); setTimeout(() => setNotice(""), 3500); };

  const signIn = (op, tok) => { setOperator(op, tok); setOp(op); };
  const lock = () => { setOperator(null); setOp(null); };

  const sendToKitchen = async (o) => {
    const lines = kitchenLines(o, catalogue.items);
    if (!lines.length || !loadPrinters().some((p) => p.role === "kitchen")) return o.printed || {};
    const added = Object.keys(o.printed || {}).length > 0;
    const results = await printKitchen({ ...o, name: o.ticketName, at: Date.now(), by: operator?.name || user, lines }, printCtx, { added });
    if (results.some((r) => !r.ok)) say(P.print.kitchenFailed);
    const printed = { ...(o.printed || {}) };
    for (const l of lines) printed[l.key] = (printed[l.key] || 0) + l.qty;
    return printed;
  };

  const saveTicket = async () => {
    setBusy(true);
    try {
      const printed = await sendToKitchen(order);
      await call(token, "ticket", { method: "PUT", body: {
        id: order.ticketId, name: order.ticketName, table: order.table, orderType: order.orderType,
        customerId: order.customerId, discount: order.discount, note: order.note, lines: order.lines, printed, branchId,
      } });
      setOrder(emptyOrder(order.orderType));
      say(P.tickets.saved);
    } catch (err) {
      say(err instanceof RegisterError ? (P.errors[err.body?.error] || P.errors.generic) : P.errors.offlineTicket);
    } finally {
      setBusy(false);
    }
  };

  const onSold = async (sold) => {
    setDone(sold);
    const receipt = sold.receipt;
    const cash = (receipt.payments || []).some((p) => p.type === "CASH");
    /* The kitchen first: the food is what the customer is waiting for. */
    await sendToKitchen(sold.order).catch(() => {});
    if (loadPrinters().some((p) => p.role === "receipt" && p.autoPrint)) {
      const customer = customers.find((c) => c.id === receipt.customer_id);
      const results = await printReceipt(receipt, { ...printCtx, customer }, { openDrawer: cash });
      if (results.some((r) => !r.ok)) say(P.print.failed);
    }
    setOrder(emptyOrder(sold.order.orderType));
    setWaiting(queued().length);
    if (sold.offline) setOnline(false);
    loadShift();
    if (receipt.customer_id) loadCustomers();
  };

  /* ── What stands between the cashier and the grid ── */

  if (loadError) {
    return <Frame><Empty icon={ShoppingCart} title={loadError} action={<div className="flex gap-2 justify-center"><Btn onClick={load}>{P.common.retry}</Btn><Btn kind="ghost" onClick={onExit}>{P.nav.backOffice}</Btn></div>} /></Frame>;
  }
  if (!catalogue) {
    return <Frame><Empty icon={ShoppingCart} title={P.common.loading} /></Frame>;
  }
  if (catalogue.pinsRequired && !operator) {
    return <Frame><PinPad token={token} onSignedIn={signIn} onExit={onExit} business={business} /></Frame>;
  }

  const needsShift = catalogue.useShifts && shift === null && view === "sell";
  const branchName = catalogue.branches?.find((b) => b.id === branchId)?.name || "";
  const can = catalogue.can || {};

  const body = needsShift ? (
    <OpenShift token={token} branchId={branchId} onOpened={loadShift} P={P} />
  ) : view === "sell" ? (
    <Sell token={token} catalogue={catalogue} order={order} setOrder={setOrder} branchId={branchId} wide={wide}
      customers={customers} onCustomersChanged={loadCustomers} onSaveTicket={saveTicket} onSold={onSold} can={can}
      onSetPrice={setPricing} busy={busy} />
  ) : view === "tickets" ? (
    <Tickets token={token} catalogue={catalogue} branchId={branchId} canVoid={can.refund} operator={operator?.name || user}
      onOpen={(tk) => { setOrder({ ...emptyOrder(tk.orderType), ...tk, ticketName: tk.name || "", table: tk.table || "", ticketId: tk.id, customerId: tk.customerId || "", lines: tk.lines.map((l) => ({ ...l, key: l.key || `l${Math.random().toString(36).slice(2, 8)}`, addons: l.addons || [], note: l.note || "", discount: l.discount || null })) }); setView("sell"); }} />
  ) : view === "receipts" ? (
    <Receipts token={token} catalogue={catalogue} branchId={branchId} can={can} printCtx={printCtx} customers={customers} onChanged={loadShift} />
  ) : view === "shift" ? (
    <Shift token={token} branchId={branchId} shift={shift} summary={summary} onChanged={loadShift} printCtx={printCtx} business={business} catalogue={catalogue} />
  ) : view === "customers" ? (
    <Customers token={token} customers={customers} onChanged={loadCustomers} />
  ) : (
    <RegisterSettings token={token} catalogue={catalogue} onChanged={load} printCtx={printCtx} />
  );

  const status = (
    <div className="flex items-center gap-1.5">
      {!online && <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold" style={{ background: "rgba(251,191,36,0.15)", color: C.amber }}><WifiOff size={12} />{P.status.offline}</span>}
      {waiting > 0 && <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold" style={{ background: "var(--chip-bg)", color: C.slate }}><CloudUpload size={12} />{fill(P.status.waiting, { n: waiting })}</span>}
      {catalogue.useShifts && <span className="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold" style={{ background: shift ? "rgba(52,211,153,0.14)" : "var(--chip-bg)", color: shift ? C.mint : C.slate }}><Wallet size={12} />{shift ? P.status.shiftOpen : P.status.shiftClosed}</span>}
    </div>
  );

  const topBar = (
    <header className="shrink-0 flex items-center gap-3 px-3 sm:px-4 h-14" style={{ background: "var(--panel-glass)", borderBottom: `1px solid ${C.hairline}`, backdropFilter: "blur(20px)" }}>
      <button onClick={onExit} className="flex items-center gap-2 pe-2 rounded-xl min-w-0" aria-label={P.nav.backOffice}>
        <BrandMark size={28} />
        <span className="min-w-0 text-start">
          <span className="block text-sm font-bold truncate leading-tight">{P.nav.register}</span>
          <span className="block text-[11px] truncate" style={{ color: C.slate }}>{branchName}</span>
        </span>
      </button>
      {catalogue.branches?.length > 1 && (
        <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="text-xs font-semibold rounded-xl px-2 py-1.5"
          style={{ background: "var(--chip-bg)", color: C.ink }}>
          {catalogue.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      )}
      <div className="flex-1" />
      {status}
      {operator && (
        <button onClick={lock} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold" style={{ background: C.irisWash, color: C.iris }}>
          <Lock size={13} />{operator.name}
        </button>
      )}
    </header>
  );

  const railItem = ({ id, icon: Icon }) => (
    <button key={id} onClick={() => setView(id)} className="w-full flex flex-col items-center gap-1 py-3 rounded-2xl"
      style={{ background: view === id ? C.irisWash : "transparent", color: view === id ? C.iris : C.slate }} aria-current={view === id ? "page" : undefined}>
      <Icon size={21} strokeWidth={view === id ? 2.4 : 1.9} />
      <span className="text-[11px] font-semibold">{P.views[id]}</span>
    </button>
  );

  return (
    <div className="h-screen flex flex-col" style={{ background: C.bone, color: C.ink, paddingTop: "var(--inset-top)" }}>
      {topBar}
      <div className="flex-1 min-h-0 flex">
        {wide && (
          <nav className="w-[92px] shrink-0 flex flex-col gap-1 p-2" style={{ borderInlineEnd: `1px solid ${C.hairline}`, background: "var(--panel-glass)" }}>
            {VIEWS.map(railItem)}
            <div className="flex-1" />
            <button onClick={onExit} className="w-full flex flex-col items-center gap-1 py-3 rounded-2xl" style={{ color: C.slate }}>
              <ArrowLeftRight size={20} /><span className="text-[11px] font-semibold text-center leading-tight">{P.nav.backOffice}</span>
            </button>
          </nav>
        )}
        <main className="flex-1 min-w-0 min-h-0 relative">{body}</main>
      </div>
      {!wide && (
        <nav className="shrink-0 grid grid-cols-5" style={{ background: "var(--panel-solid)", borderTop: `1px solid ${C.hairline}`, paddingBottom: "var(--inset-bottom)" }}>
          {VIEWS.slice(0, 4).map(({ id, icon: Icon }) => (
            <button key={id} onClick={() => { setView(id); setMore(false); }} className="flex flex-col items-center justify-center gap-1 py-2 min-h-[56px]"
              style={{ color: view === id && !more ? C.iris : C.slate }}>
              <Icon size={21} strokeWidth={view === id ? 2.4 : 1.9} /><span className="text-[10.5px] font-semibold">{P.views[id]}</span>
            </button>
          ))}
          <button onClick={() => setMore(true)} className="flex flex-col items-center justify-center gap-1 py-2 min-h-[56px]" style={{ color: more ? C.iris : C.slate }}>
            <MoreHorizontal size={21} /><span className="text-[10.5px] font-semibold">{P.nav.more}</span>
          </button>
        </nav>
      )}

      {more && (
        <Sheet title={P.nav.more} onClose={() => setMore(false)}>
          <div className="space-y-1.5">
            {VIEWS.slice(4).map(({ id, icon: Icon }) => (
              <button key={id} onClick={() => { setView(id); setMore(false); }} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-sm font-semibold" style={{ background: "var(--chip-bg)" }}>
                <Icon size={18} />{P.views[id]}
              </button>
            ))}
            {operator && (
              <button onClick={() => { lock(); setMore(false); }} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-sm font-semibold" style={{ background: "var(--chip-bg)" }}>
                <Lock size={18} />{P.pin.switch}
              </button>
            )}
            <button onClick={onExit} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-sm font-semibold" style={{ background: "var(--chip-bg)" }}>
              <ArrowLeftRight size={18} />{P.nav.backOffice}
            </button>
            <button onClick={onLogout} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-sm font-semibold" style={{ color: C.rose }}>
              <LogOut size={18} className="flip-rtl" />{t.common.signOut}
            </button>
          </div>
        </Sheet>
      )}

      {done && <Done sold={done} P={P} printCtx={printCtx} customers={customers} onClose={() => setDone(null)} />}
      {pricing && <PriceSheet token={token} item={pricing} P={P} onClose={() => setPricing(null)} onSaved={() => { setPricing(null); load(); }} />}

      {notice && (
        <div className="fixed bottom-24 inset-x-0 flex justify-center z-50 pointer-events-none">
          <span className="px-4 py-2.5 rounded-full text-sm font-semibold shadow-xl" style={{ background: C.ink, color: C.surface }}>{notice}</span>
        </div>
      )}
    </div>
  );
}

function Frame({ children }) {
  const C = useC();
  return <div className="h-screen" style={{ background: C.bone, color: C.ink, paddingTop: "var(--inset-top)" }}>{children}</div>;
}

/* After the sale: the change to hand back, and the receipt. */
function Done({ sold, P, printCtx, customers, onClose }) {
  const C = useC();
  const [printing, setPrinting] = useState(false);
  const r = sold.receipt;
  const change = (r.payments || []).reduce((s, p) => s + Number(p.change || 0), 0);
  const reprint = async () => {
    setPrinting(true);
    await printReceipt(r, { ...printCtx, customer: customers.find((c) => c.id === r.customer_id) }).catch(() => {});
    setPrinting(false);
  };
  return (
    <Sheet title={P.done.title} onClose={onClose}
      footer={<div className="flex gap-2"><Btn kind="ghost" onClick={reprint} disabled={printing || !loadPrinters().some((p) => p.role === "receipt")}><Printer size={16} />{P.done.print}</Btn><Btn full size="lg" onClick={onClose}>{P.done.newSale}</Btn></div>}>
      <div className="text-center py-4">
        <div className="w-16 h-16 rounded-full mx-auto mb-3 flex items-center justify-center" style={{ background: "rgba(52,211,153,0.15)", color: C.mint }}><Check size={30} /></div>
        {change > 0 ? (
          <>
            <div className="text-sm font-semibold" style={{ color: C.slate }}>{P.done.change}</div>
            <div className="data text-5xl font-extrabold my-1" dir="ltr">{money(change)}</div>
          </>
        ) : (
          <div className="data text-4xl font-extrabold my-1" dir="ltr">{money(r.total_money)}</div>
        )}
        <div className="text-xs mt-2 data" dir="ltr" style={{ color: C.slate }}>{r.receipt_number}</div>
        {sold.offline && <p className="text-xs mt-3 font-semibold" style={{ color: C.amber }}>{P.done.offline}</p>}
      </div>
    </Sheet>
  );
}

/* A shift has to be open before selling, when the business counts its drawer. */
function OpenShift({ token, branchId, onOpened, P }) {
  const C = useC();
  const [float, setFloat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = async () => {
    setBusy(true);
    setError("");
    try {
      await call(token, "shift-open", { method: "POST", body: { branchId, float: Number(float) || 0 } });
      onOpened();
    } catch (err) {
      setError(err instanceof RegisterError ? (P.errors[err.body?.error] || P.errors.generic) : P.errors.network);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="h-full overflow-y-auto flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-5">
          <div className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center" style={{ background: C.irisWash, color: C.iris }}><Wallet size={24} /></div>
          <h2 className="display font-bold text-xl">{P.shift.openTitle}</h2>
          <p className="text-sm mt-1" style={{ color: C.slate }}>{P.shift.openLead}</p>
        </div>
        <div className="flex items-center justify-between px-4 py-3 rounded-2xl mb-3" style={{ background: "var(--chip-bg)" }}>
          <span className="text-sm font-semibold" style={{ color: C.slate }}>{P.shift.float}</span>
          <span className="data text-2xl font-bold" dir="ltr">{float || "0"}</span>
        </div>
        <Keypad onKey={(k) => setFloat((v) => keyInto(v, k))} />
        {error && <p className="text-sm mt-3" style={{ color: C.rose }}>{error}</p>}
        <Btn full size="lg" className="mt-4" disabled={busy} onClick={open}>{P.shift.open}</Btn>
      </div>
    </div>
  );
}

/* Pricing a dish that has none, from the till, by somebody allowed to. */
function PriceSheet({ token, item, P, onClose, onSaved }) {
  const C = useC();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true);
    try {
      if (item.kind === "product") await call(token, "product", { method: "PUT", body: { id: item.id, name: item.name, price: Number(value), category: item.category } });
      else await call(token, "price", { method: "PUT", body: { itemId: item.id, price: Number(value) } });
      onSaved();
    } catch {
      setError(P.errors.generic);
      setBusy(false);
    }
  };
  return (
    <Sheet title={fill(P.sell.priceFor, { name: item.name })} onClose={onClose}
      footer={<Btn full size="lg" disabled={busy || !(Number(value) > 0)} onClick={save}>{P.common.save}</Btn>}>
      <p className="text-sm mb-3" style={{ color: C.slate }}>{P.sell.priceHint}</p>
      <Field value={value} onChange={setValue} inputMode="decimal" dir="ltr" autoFocus placeholder="0.00" />
      {error && <p className="text-sm" style={{ color: C.rose }}>{error}</p>}
    </Sheet>
  );
}

