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
import { ShoppingCart, ClipboardList, Receipt, Wallet, Users, Settings, LogOut, Lock, WifiOff, CloudUpload, MoreHorizontal, Printer, Check, ArrowLeftRight, KeyRound, Mail } from "lucide-react";
import { LockDeviceSheet, UnlockSheet } from "./DeviceLock.jsx";
import EmailReceipt from "./EmailReceipt.jsx";
import { useAppFrame } from "../appFrame.js";
import { useC } from "../theme.jsx";
import { useLang, fill, localeFor } from "../i18n.jsx";
import BrandMark from "../BrandMark.jsx";
import { Btn, Sheet, Keypad, keyInto, Empty, Field, money } from "./ui.jsx";
import Sell, { emptyOrder, lineName } from "./Sell.jsx";
import Tickets from "./Tickets.jsx";
import Receipts from "./Receipts.jsx";
import Shift from "./Shift.jsx";
import Customers from "./Customers.jsx";
import RegisterSettings from "./RegisterSettings.jsx";
import PinPad from "./PinPad.jsx";
import {
  loadCatalogue, call, flush, queued, enqueue, savedOperator, setOperator, savedBranch, saveBranch, RegisterError,
  isNetworkError, savedShift, saveShift, savedCustomers, saveCustomers, refusedSales, setQueueOwner, operatorToken,
} from "./api.js";
import { printReceipt, printKitchen, loadPrinters, setPrintSession, kitchenWork, applyKitchenResults, settleKitchen } from "../print/printers.js";
import KitchenRetry from "./KitchenRetry.jsx";
import { printProblem } from "./printText.js";

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

/* Every line of an order as the kitchen reads it. Which printer still owes
   which of them is worked out from this (`print/kitchen.js`). */
function kitchenLinesOf(order, items, P) {
  const byId = new Map(items.map((i) => [i.id, i]));
  return order.lines
    .map((l) => ({ l, item: byId.get(l.itemId) }))
    .filter((x) => x.item)
    .map(({ l, item }) => ({
      key: l.key, qty: l.qty, name: lineName(item, l, P), category: item.category, note: l.note,
      addons: l.addons.map((a) => item.addons?.find((x) => x.id === a)?.name || a),
    }));
}

/* A ticket as the till holds it, from one the server kept. */
const orderFromTicket = (tk) => ({
  ...emptyOrder(tk.orderType), ...tk, ticketName: tk.name || "", table: tk.table || "", ticketId: tk.id, customerId: tk.customerId || "",
  lines: tk.lines.map((l) => ({ ...l, key: l.key || `l${Math.random().toString(36).slice(2, 8)}`, addons: l.addons || [], note: l.note || "", discount: l.discount || null })),
});

export default function RegisterApp({ token, user, business: businessProp, onExit, onLogout, onSession, deviceLocked = false, onUnlocked }) {
  const C = useC();
  const { t, lang, rtl } = useLang();
  const P = t.pos;
  useAppFrame();
  const wide = useWide();

  const [catalogue, setCatalogue] = useState(null);
  const [loadError, setLoadError] = useState("");
  /* Before anything reads the queue: unsent sales are kept per person. */
  setQueueOwner(user);
  /* And before anything prints: a network printer on the website is reached
     through the server, as whoever is signed in. */
  setPrintSession(() => ({ token, operator: operatorToken() }));
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
  const [shiftStale, setShiftStale] = useState(false);
  const [refused, setRefused] = useState(refusedSales().length);
  const [kitchenRetry, setKitchenRetry] = useState(null);
  /* The receipt that did not print after a sale: { number, text }. */
  const [receiptNote, setReceiptNote] = useState(null);
  const [lockOpen, setLockOpen] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  /* A staff device has no back office to go back to: the way out is a
     manager signing in. */
  const exit = deviceLocked ? () => setUnlockOpen(true) : onExit;
  const ExitIcon = deviceLocked ? KeyRound : ArrowLeftRight;
  const exitLabel = deviceLocked ? P.device.exit : P.nav.backOffice;

  /* A store's own address, phone and tax number replace the business-wide
     ones on its receipts, field by field, so a second branch prints where it
     is rather than where the first one is. */
  const business = businessProp || catalogue?.receipt?.business || "";

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
    try {
      const list = (await call(token, "customers")).customers || [];
      setCustomers(list);
      saveCustomers(user, list);
    } catch (err) {
      /* No connection: the customers as this device last knew them, so a
         regular can still be put on a sale. */
      if (isNetworkError(err)) setCustomers((have) => (have.length ? have : savedCustomers(user)));
    }
  }, [token, user]);

  const loadShift = useCallback(async () => {
    if (!branchId) return;
    try {
      const out = await call(token, "shift", { query: { branchId } });
      setShift(out.shift);
      setSummary(out.summary || null);
      setShiftStale(false);
      saveShift(branchId, { shift: out.shift, summary: out.summary || null });
    } catch (err) {
      /* With no connection the shift is whatever it last was on this device.
         And when this device has never seen one, it is left unknown rather
         than taken for "none": unknown does not stop a sale, and the server
         takes a sale made offline with or without a shift. A till that
         refuses to sell because it could not ask a question is not a till. */
      if (isNetworkError(err)) {
        const saved = savedShift(branchId);
        if (saved) {
          setShift((s) => (s === undefined || s === null || s?.pending ? saved.shift : s));
          setSummary((cur) => cur || saved.summary || null);
          setShiftStale(true);
        }
        return;
      }
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
      setRefused(refusedSales().length);
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

  /* Send the kitchen what it has not had, and report what actually happened.

     Answers with the ticket's record of what each printer has printed —
     moved on only for the printers that did print — and the ones that did
     not. It used to mark every line as sent whatever the printer said, so a
     kitchen printer that was off swallowed orders in silence. */
  const sendToKitchen = async (o, { again = {}, whole = false } = {}) => {
    const record = { printed: o.printed || {}, printedOn: o.printedOn || {} };
    const printers = loadPrinters().filter((p) => p.role === "kitchen");
    if (!printers.length) return { ...record, failures: [] };
    const lines = kitchenLinesOf(o, catalogue.items, P);
    const work = kitchenWork(o, lines, printers, { manual: whole, whole });
    if (!work.length) return { ...record, failures: [] };
    const results = await printKitchen({ ...o, name: o.ticketName, at: Date.now(), by: operator?.name || user }, printCtx, work, { again, whole });
    const next = whole ? record : applyKitchenResults(o, lines, printers, work, results);
    return { ...next, failures: results.map((r, i) => ({ ...r, work: work[i] })).filter((r) => !r.ok) };
  };

  const ticketBody = (o, record) => ({
    id: o.ticketId, name: o.ticketName, table: o.table, orderType: o.orderType, channelId: o.channelId || "",
    customerId: o.customerId, discount: o.discount, note: o.note, lines: o.lines, printed: record.printed, printedOn: record.printedOn, branchId,
  });

  const saveTicket = async () => {
    setBusy(true);
    let record = { printed: order.printed || {}, printedOn: order.printedOn || {} };
    try {
      const sent = await sendToKitchen(order);
      record = { printed: sent.printed, printedOn: sent.printedOn };
      const saved = await call(token, "ticket", { method: "PUT", body: ticketBody(order, record) });
      setOrder(emptyOrder(order.orderType));
      if (sent.failures.length) setKitchenRetry({ order: { ...order, ...record }, failures: sent.failures, ticketId: saved?.ticket?.id || order.ticketId || null });
      else say(P.tickets.saved);
    } catch (err) {
      /* The ticket did not save, but the kitchen may have been sent some of
         it: the order keeps that, so saving again does not print it twice. */
      setOrder((o) => ({ ...o, ...record }));
      say(err instanceof RegisterError ? (P.errors[err.body?.error] || P.errors.generic) : P.errors.offlineTicket);
    } finally {
      setBusy(false);
    }
  };

  /* The retry sheet's three answers: try the failed printers again, print
     one again that may already be on paper, or say that it did print. */
  const retryKitchen = async ({ again = {}, printedByHand = [] } = {}) => {
    const held = kitchenRetry;
    if (!held) return;
    setBusy(true);
    try {
      let o = held.order;
      if (printedByHand.length) {
        const works = held.failures.filter((f) => printedByHand.includes(f.key)).map((f) => f.work);
        works.forEach(settleKitchen);
        const printers = loadPrinters().filter((p) => p.role === "kitchen");
        o = { ...o, ...applyKitchenResults(o, kitchenLinesOf(o, catalogue.items, P), printers, works, works.map(() => ({ ok: true }))) };
      }
      const sent = await sendToKitchen(o, { again });
      const next = { ...o, printed: sent.printed, printedOn: sent.printedOn };
      if (held.ticketId) {
        await call(token, "ticket-printed", { method: "PUT", body: { id: held.ticketId, printed: next.printed, printedOn: next.printedOn } }).catch(() => {});
      }
      if (sent.failures.length) setKitchenRetry({ ...held, order: next, failures: sent.failures });
      else { setKitchenRetry(null); say(P.print.retry.done); }
    } finally {
      setBusy(false);
    }
  };

  /* The whole order again, to every kitchen printer: the ticket was lost,
     or its printer does not print by itself. Changes no record. */
  const reprintKitchen = async (tk) => {
    const sent = await sendToKitchen(orderFromTicket(tk), { whole: true });
    say(sent.failures.length ? printProblem(P, sent.failures[0]) : P.tickets.kitchenSent);
  };

  const onSold = async (sold) => {
    setDone(sold);
    setReceiptNote(null);
    const receipt = sold.receipt;
    const cash = (receipt.payments || []).some((p) => p.type === "CASH");
    /* The till is ready for the next customer at once; the printers report
       back when they have something to say. */
    setOrder(emptyOrder(sold.order.orderType));
    setWaiting(queued().length);
    if (sold.offline) setOnline(false);
    loadShift();
    if (receipt.customer_id) loadCustomers();
    /* The kitchen first: the food is what the customer is waiting for. */
    const kitchen = sendToKitchen(sold.order).catch(() => null);
    /* A receipt only where a printer is set to print one after every sale. */
    const customer = customers.find((c) => c.id === receipt.customer_id);
    const receipts = printReceipt(receipt, { ...printCtx, customer }, { openDrawer: cash, auto: true }).catch(() => []);
    const sent = await kitchen;
    if (sent?.failures.length) setKitchenRetry({ order: { ...sold.order, printed: sent.printed, printedOn: sent.printedOn }, failures: sent.failures, ticketId: null });
    const bad = (await receipts).find((r) => !r.ok);
    if (bad) {
      /* Kept on the paid screen, where the cashier is looking, and said
         once in passing for whoever has already moved on to the next sale:
         a customer waiting for a receipt that is not coming needs somebody
         to know. */
      const text = printProblem(P, bad);
      setReceiptNote({ number: receipt.receipt_number, text });
      say(text);
    }
  };

  const deviceSheets = (
    <>
      {lockOpen && <LockDeviceSheet token={token} pinsRequired={catalogue?.pinsRequired}
        onClose={() => setLockOpen(false)} onLocked={(tk) => { setLockOpen(false); onSession?.(tk); }} />}
      {unlockOpen && <UnlockSheet onClose={() => setUnlockOpen(false)} onUnlocked={(tk, name) => { setUnlockOpen(false); onUnlocked?.(tk, name); }} />}
    </>
  );

  /* ── What stands between the cashier and the grid ── */

  if (loadError) {
    return <Frame><Empty icon={ShoppingCart} title={loadError} action={<div className="flex gap-2 justify-center"><Btn onClick={load}>{P.common.retry}</Btn><Btn kind="ghost" onClick={exit}>{exitLabel}</Btn></div>} />{deviceSheets}</Frame>;
  }
  if (!catalogue) {
    return <Frame><Empty icon={ShoppingCart} title={P.common.loading} /></Frame>;
  }
  if (catalogue.pinsRequired && !operator) {
    return <Frame><PinPad token={token} onSignedIn={signIn} onExit={exit} exitLabel={exitLabel} business={business} />{deviceSheets}</Frame>;
  }

  const needsShift = catalogue.useShifts && shift === null && view === "sell";
  const branchName = catalogue.branches?.find((b) => b.id === branchId)?.name || "";
  const can = catalogue.can || {};

  const body = needsShift ? (
    <OpenShift token={token} branchId={branchId} P={P} by={operator?.name || user}
      onOpened={(local) => {
        if (!local) { loadShift(); return; }
        /* Opened with no connection: the till carries on with its own copy,
           and the opening is sent ahead of the sales that follow it. */
        setShift(local);
        setSummary(null);
        saveShift(branchId, { shift: local, summary: null });
        setWaiting(queued().length);
        setOnline(false);
        say(P.offline.shiftOpened);
      }} />
  ) : view === "sell" ? (
    <Sell token={token} catalogue={catalogue} order={order} setOrder={setOrder} branchId={branchId} wide={wide}
      customers={customers} onCustomersChanged={loadCustomers} onSaveTicket={saveTicket} onSold={onSold} can={can}
      onSetPrice={setPricing} busy={busy} />
  ) : view === "tickets" ? (
    <Tickets token={token} catalogue={catalogue} branchId={branchId} canVoid={can.refund} operator={operator?.name || user}
      onPrint={loadPrinters().some((p) => p.role === "kitchen") ? reprintKitchen : null}
      onOpen={(tk) => { setOrder(orderFromTicket(tk)); setView("sell"); }} />
  ) : view === "receipts" ? (
    <Receipts token={token} catalogue={catalogue} branchId={branchId} can={can} printCtx={printCtx} customers={customers} onChanged={loadShift} queueTick={`${waiting}:${refused}`} />
  ) : view === "shift" ? (
    <Shift token={token} branchId={branchId} shift={shift} summary={summary} onChanged={loadShift} printCtx={printCtx} business={business} catalogue={catalogue} stale={shiftStale || Boolean(shift?.pending)} />
  ) : view === "customers" ? (
    <Customers token={token} customers={customers} onChanged={loadCustomers} />
  ) : (
    <RegisterSettings token={token} catalogue={catalogue} onChanged={load} printCtx={printCtx} />
  );

  /* On a phone there is room for the sign and the number, not the sentence:
     the words are for wider screens, and stay available to a screen reader
     and on a long press. Nothing here wraps — a chip broken over three lines
     pushed the name of the register off the bar. */
  const chip = "shrink-0 whitespace-nowrap flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold";
  const waitingLabel = fill(P.status.waiting, { n: waiting });
  const status = (
    <div className="flex items-center gap-1.5 shrink-0">
      {!online && <span className={chip} title={P.status.offline} aria-label={P.status.offline} style={{ background: "rgba(251,191,36,0.15)", color: C.amber }}><WifiOff size={12} /><span className="hidden sm:inline">{P.status.offline}</span></span>}
      {waiting > 0 && <button onClick={() => setView("receipts")} className={chip} title={waitingLabel} aria-label={waitingLabel} style={{ background: "var(--chip-bg)", color: C.slate }}><CloudUpload size={12} /><span className="hidden sm:inline">{waitingLabel}</span><span className="sm:hidden data">{waiting}</span></button>}
      {/* Sales the server would not take: never out of sight. Opens the list. */}
      {refused > 0 && <button onClick={() => setView("receipts")} className={chip} title={P.offline.refused} aria-label={`${P.offline.refused} · ${refused}`} style={{ background: "rgba(244,63,94,0.14)", color: C.rose }}><CloudUpload size={12} /><span className="hidden sm:inline">{P.offline.refused} ·</span><span className="data">{refused}</span></button>}
      {catalogue.useShifts && <span className="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold" style={{ background: shift ? "rgba(52,211,153,0.14)" : "var(--chip-bg)", color: shift ? C.mint : C.slate }}><Wallet size={12} />{shift ? P.status.shiftOpen : P.status.shiftClosed}</span>}
    </div>
  );

  const topBar = (
    /* The header's own background runs up behind the status bar; its contents
       sit below it. */
    <header className="shrink-0 flex items-center gap-3 px-3 sm:px-4" style={{ height: "calc(3.5rem + var(--inset-top))", paddingTop: "var(--inset-top)", background: "var(--panel-glass)", borderBottom: `1px solid ${C.hairline}`, backdropFilter: "blur(20px)" }}>
      <button onClick={exit} className="flex items-center gap-2 pe-2 rounded-xl min-w-0" aria-label={exitLabel}>
        <BrandMark size={28} />
        <span className="min-w-0 text-start">
          <span className="block text-sm font-bold truncate leading-tight">{P.nav.register}</span>
          <span className="block text-[11px] truncate" style={{ color: C.slate }}>{branchName}</span>
        </span>
      </button>
      {catalogue.branches?.length > 1 && (
        <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="min-w-0 max-w-[40%] text-xs font-semibold rounded-xl px-2 py-1.5"
          style={{ background: "var(--chip-bg)", color: C.ink }}>
          {catalogue.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      )}
      <div className="flex-1" />
      {status}
      {operator && (
        <button onClick={lock} className="shrink-0 max-w-[30%] flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold" style={{ background: C.irisWash, color: C.iris }}>
          <Lock size={13} className="shrink-0" /><span className="truncate">{operator.name}</span>
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
    <div className="h-screen flex flex-col" style={{ background: C.bone, color: C.ink }}>
      {topBar}
      <div className="flex-1 min-h-0 flex">
        {wide && (
          <nav className="w-[92px] shrink-0 flex flex-col gap-1 p-2" style={{ borderInlineEnd: `1px solid ${C.hairline}`, background: "var(--panel-glass)", paddingBottom: "calc(var(--inset-bottom) + 0.5rem)" }}>
            {VIEWS.map(railItem)}
            <div className="flex-1" />
            <button onClick={exit} className="w-full flex flex-col items-center gap-1 py-3 rounded-2xl" style={{ color: C.slate }}>
              <ExitIcon size={20} /><span className="text-[11px] font-semibold text-center leading-tight">{exitLabel}</span>
            </button>
          </nav>
        )}
        {/* Keyed by view, so moving between Sell, Receipts and Shift eases the
            new one in rather than swapping it under the cashier's thumb. */}
        <main className="flex-1 min-w-0 min-h-0 relative"><div key={view} className="h-full pane-in">{body}</div></main>
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
            {catalogue.device?.canLock && onSession && (
              <button onClick={() => { setMore(false); setLockOpen(true); }} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-sm font-semibold" style={{ background: "var(--chip-bg)" }}>
                <Lock size={18} />{P.device.lock}
              </button>
            )}
            <button onClick={() => { setMore(false); exit(); }} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-sm font-semibold" style={{ background: "var(--chip-bg)" }}>
              <ExitIcon size={18} />{exitLabel}
            </button>
            {!deviceLocked && (
              <button onClick={onLogout} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-sm font-semibold" style={{ color: C.rose }}>
                <LogOut size={18} className="flip-rtl" />{t.common.signOut}
              </button>
            )}
          </div>
        </Sheet>
      )}

      {deviceSheets}
      {done && <Done token={token} sold={done} P={P} printCtx={printCtx} customers={customers} onClose={() => setDone(null)}
        autoNote={receiptNote?.number === done.receipt.receipt_number ? receiptNote.text : ""} />}
      {kitchenRetry && <KitchenRetry P={P} held={kitchenRetry} busy={busy} onRetry={retryKitchen} onClose={() => setKitchenRetry(null)} />}
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
function Done({ token, sold, P, printCtx, customers, onClose, autoNote = "" }) {
  const C = useC();
  const [printing, setPrinting] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const customer = customers.find((c) => c.id === sold.receipt.customer_id);
  const r = sold.receipt;
  const change = (r.payments || []).reduce((s, p) => s + Number(p.change || 0), 0);
  /* null until the cashier prints from here; after that, what that print
     said — which replaces whatever the automatic one after the sale said. */
  const [printNote, setPrintNote] = useState(null);
  const note = printNote ?? autoNote;
  const reprint = async () => {
    setPrinting(true);
    setPrintNote("");
    const results = await printReceipt(r, { ...printCtx, customer: customers.find((c) => c.id === r.customer_id) }).catch(() => []);
    const bad = results.find((x) => !x.ok);
    if (bad) setPrintNote(printProblem(P, bad));
    setPrinting(false);
  };
  return (
    <Sheet title={P.done.title} onClose={onClose}
      footer={<div className="flex gap-2">
        <Btn kind="ghost" onClick={reprint} disabled={printing || !loadPrinters().some((p) => p.role === "receipt")}><Printer size={16} />{P.done.print}</Btn>
        {/* A sale made offline has no receipt on the server to send yet. */}
        <Btn kind="ghost" onClick={() => setEmailing(true)} disabled={sold.offline}><Mail size={16} />{P.email.action}</Btn>
        <Btn full size="lg" onClick={onClose}>{P.done.newSale}</Btn>
      </div>}>
      {emailing && <EmailReceipt token={token} number={r.receipt_number} initial={customer?.email || ""} onClose={() => setEmailing(false)} />}
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
        {note && <p className="text-xs mt-3 font-semibold" role="status" style={{ color: C.rose }}>{note}</p>}
      </div>
    </Sheet>
  );
}

/* A shift has to be open before selling, when the business counts its drawer. */
function OpenShift({ token, branchId, onOpened, P, by }) {
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
      if (isNetworkError(err)) {
        /* No connection is not a reason to keep the till shut. The opening
           is queued like a sale, and the float is what was typed. */
        const at = Date.now();
        const body = { branchId, float: Number(float) || 0, offline: true, at, by: by || "" };
        enqueue("shift-open", body);
        onOpened({ id: `local-${at.toString(36)}`, branchId, float: body.float, openedAt: at, openedBy: by || "", moves: [], pending: true });
        return;
      }
      setError(P.errors[err.body?.error] || P.errors.generic);
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
      /* The whole product goes back, not just its price: the save replaces
         it, and a price set here must not drop its barcode or stock link. */
      if (item.kind === "product") {
        await call(token, "product", { method: "PUT", body: {
          id: item.id, name: item.name, price: Number(value), cost: item.cost ?? null, category: item.category,
          barcode: item.barcode, sku: item.sku, color: item.color, hidden: item.hidden, stock: item.stock || null,
        } });
      }
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

