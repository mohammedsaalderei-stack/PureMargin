import { useCallback, useEffect, useRef, useState } from "react";
import {
  BarChart3, LineChart, MessageSquare, Settings as Cog, UtensilsCrossed, Users,
  Search, Lightbulb, PanelRightClose, PanelRightOpen, LogOut, Lock, Wallet,
  LayoutDashboard, Download, FileText, Table, ChevronDown, Package, ChefHat, Scale, BellRing, ShoppingCart, Calculator, Receipt, MessagesSquare, Store, Bike,} from "lucide-react";
import { useC } from "./theme.jsx";
import BrandMark from "./BrandMark.jsx";
import { useLang, fill } from "./i18n.jsx";
import { useSwipe } from "./hooks-nav.js";
import { useRoute, navigate } from "./router.js";
import useBackToClose from "./useBackToClose.js";
import {
  listConversations, saveConversation, deleteConversation, newId, getConversation,
  fetchRemote, pushRemote, deleteRemote, merge,
} from "./conversations.js";
import Ask from "./screens/Ask.jsx";
import Watch from "./screens/Watch.jsx";
import Menu from "./screens/Menu.jsx";
import Advice from "./screens/Advice.jsx";
import Overview from "./screens/Overview.jsx";
import ChatSidebar from "./ChatSidebar.jsx";
import Forecast from "./screens/Forecast.jsx";
import Settings from "./screens/Settings.jsx";
import Team from "./screens/Team.jsx";
import Messages from "./screens/Messages.jsx";
import { rememberScope, rememberedScope } from "./session.js";
import Inventory from "./screens/Inventory.jsx";
import Recipes from "./screens/Recipes.jsx";
import Variance from "./screens/Variance.jsx";
import Alerts from "./screens/Alerts.jsx";
import Plan from "./screens/Plan.jsx";
import Costs from "./screens/Costs.jsx";
import Sales from "./screens/Sales.jsx";
import RegisterApp from "./register/RegisterApp.jsx";
import Employees from "./screens/Employees.jsx";
import BranchScope from "./BranchScope.jsx";
import BusinessTypePicker from "./BusinessTypePicker.jsx";
import CommandPalette from "./CommandPalette.jsx";
import LanguagePicker from "./LanguagePicker.jsx";
import ThemeToggle from "./ThemeToggle.jsx";
import Skeleton from "./Skeleton.jsx";
import EmptyTable from "./EmptyTable.jsx";
import Channels from "./screens/Channels.jsx";
import OfflineBanner, { useOffline } from "./OfflineBanner.jsx";
import TillBanner from "./TillBanner.jsx";
import { useAppFrame } from "./appFrame.js";
import LiveDot from "./LiveDot.jsx";
import { PortalSwitcher, SectionTabs, BottomBar, MoreSheet, AccountMenu } from "./AppChrome.jsx";
import { layoutFor, portalOf, landingOf, ACCOUNT } from "./nav.js";
import NotificationBell from "./NotificationBell.jsx";
import { depleteFromSales } from "./depletion.js";
import Plans, { Locked } from "./screens/Plans.jsx";
import { entitlements, SCREEN_FEATURE } from "./entitlements.js";
import Transition from "./Transition.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import { AmbientBackground } from "./ui.jsx";
import { exportPDF } from "./export-pdf.js";
import { exportCSV } from "./export-csv.js";
import "./glass.css";

const EMPTY_METRICS = {
  connected: false, source: "—", currency: "AED", stores: [], items: [],
  hours: [], daily: [], payments: [], observations: [], advice: [],
  totals: { sales: 0, receipts: 0, avgTicket: 0, salesDelta: 0, receiptsDelta: 0, avgTicketDelta: 0, peakHour: "—" },
  forecast: { conservative: 0, base: 0, optimistic: 0, series: [] },
  menu: { items: [], medianQty: 0, medianPerUnit: 0 },
  extras: { discounts: 0, refunds: 0, cost: 0 },
  updatedAt: null,
};

const POLL_MS = 30 * 1000;

/* Ordered by importance: the numbers you check first, the cost ledger, the
   assistant, then analysis, with account plumbing last. */
const TAB_META = [
  { id: "overview", icon: LayoutDashboard },
  { id: "costs", icon: Calculator },
  { id: "ask", icon: MessageSquare },
  { id: "watch", icon: BarChart3 },
  { id: "menu", icon: UtensilsCrossed },
  { id: "forecast", icon: LineChart },
  { id: "advice", icon: Lightbulb },
  { id: "billing", icon: Wallet },
  { id: "settings", icon: Cog },
];

/* Team administration is only shown to someone who can actually use it. It
   isn't a paid feature, it's a permission — so it's appended to the nav rather
   than living in TAB_META, which drives the numeric shortcuts and swipe order
   for everyone. */
const TEAM_TAB = { id: "team", icon: Users };

/* The team board. A permission in the loosest sense — everybody in an
   organization gets it, because a board only one role can read is a memo.
   Appended rather than placed in TAB_META for the same reason as the others:
   TAB_META drives the numeric shortcuts and swipe order, and those should mean
   the same thing for every member. */
const MESSAGES_TAB = { id: "messages", icon: MessagesSquare };

/* Inventory is a permission too, not a plan feature: anyone with
   `view:inventory` gets it, which is every role except the accountant. Appended
   for the same reason as the team tab — TAB_META drives the numeric shortcuts
   and swipe order for everyone. */
const INVENTORY_TAB = { id: "inventory", icon: Package };

/* Alerts sit with inventory rather than costing: the person acting on a stockout
   is the chef, and `view:inventory` is who that is. */
const ALERTS_TAB = { id: "alerts", icon: BellRing };

/* Attendance. A permission rather than a plan feature — whoever runs a shift
   has it — so appended like the others rather than placed in TAB_META, which
   drives the numeric shortcuts and swipe order for everybody. */
const EMPLOYEES_TAB = { id: "employees", icon: Users };

/* The operational plan: purchasing needs `view:forecast`, the branch ranking
   `view:profitability`; either one is enough to have something to read. */
const PLAN_TAB = { id: "plan", icon: ShoppingCart };

/* Recipes ride on `view:costs`, not on `view:inventory`: an accountant reads what
   dishes cost without writing recipes, and a chef writes them. Appended for the
   same reason as the others. */
const RECIPES_TAB = { id: "recipes", icon: ChefHat };

/* Theoretical versus actual consumption — the same `view:costs` audience as
   recipes, since it is the costing answer they are both building towards. */
const VARIANCE_TAB = { id: "variance", icon: Scale };

/* Sales as the till reported them, and the corrections made to them. Gated on
   `view:dashboard` rather than on `adjust:sales`: reading the day's takings is
   what everybody with a dashboard already does, and the screen shows no edit
   controls to somebody who cannot use them. */
const SALES_TAB = { id: "sales", icon: Receipt };
/* PureMargin's own register. Second in the nav: for a cashier it is the job,
   and for an owner it sits beside the figures it feeds. */
const TILL_TAB = { id: "till", icon: Store };
/* Sales channels: the counter, the delivery apps, and what each one keeps. */
const CHANNELS_TAB = { id: "channels", icon: Bike };

/* Every tab there is, in the order the nav shows them.

   ── Why this is one list ─────────────────────────────────────────────────

   It was two. The rail read the icon off each tab object; the drawer looked it
   up in a separate hand-written map — and adding Attendance to the nav without
   adding it to that map made `TAB_ICONS.employees` undefined, which React
   renders as an element type of undefined and kills the screen. It only died
   on a phone, because only the drawer uses the map, so the desktop looked
   perfectly healthy while the app was unusable on the device most of this is
   used on.

   `MobileShell` carries a comment about exactly this happening once before,
   with the hand-written list of five primary tabs that went stale and left
   Bill scan unreachable on a phone. Two lists of the same thing drift; this is
   the same bug wearing different clothes, so the fix is not to add the missing
   line but to stop there being somewhere to miss.

   The nav filters this by permission and renders it in order. Nothing else
   decides what exists. */
const ALL_TABS = (() => {
  const byId = Object.fromEntries(TAB_META.map((tb) => [tb.id, tb]));
  return [
    byId.overview, TILL_TAB, SALES_TAB, byId.costs, byId.ask, CHANNELS_TAB,
    INVENTORY_TAB, ALERTS_TAB, PLAN_TAB, RECIPES_TAB, VARIANCE_TAB, EMPLOYEES_TAB,
    byId.watch, byId.menu, byId.forecast, byId.advice,
    MESSAGES_TAB, TEAM_TAB,
    byId.billing, byId.settings,
  ].filter(Boolean);
})();

const TAB_ICONS = Object.fromEntries(ALL_TABS.map((tb) => [tb.id, tb.icon]));

function useDesktop() {
  const [big, setBig] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = (e) => setBig(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return big;
}

/* Export dropdown */
function ExportMenu({ data, screen, dateRange, business, onClose }) {
  const C = useC();
  if (!data) return null;
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="absolute z-50 palette-in glass-card p-2 min-w-[180px]"
        style={{ bottom: "100%", marginBottom: 8, right: 0 }}
      >
        <button
          onClick={() => { exportPDF(screen, data, dateRange, business); onClose(); }}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium hover-soft text-start"
          style={{ color: C.ink }}
        >
          <FileText size={15} style={{ color: C.iris }} /> PDF Report
        </button>
        <button
          onClick={() => { exportCSV(screen, data, dateRange, business); onClose(); }}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium hover-soft text-start"
          style={{ color: C.ink }}
        >
          <Table size={15} style={{ color: C.cyan }} /> CSV Data
        </button>
      </div>
    </>
  );
}

/* Overview ranges worked out on the server rather than sliced from the
   30 days every screen loads. */
const LONG_PERIODS = { quarter: "90", year: "365", all: "all" };
const STOCK_POLL_MS = 5 * 60 * 1000;

export default function Shell({ token, user, onLogout, onSession, justRegistered = false }) {
  const C = useC();
  const { t, rtl } = useLang();
  const desktop = useDesktop();
  /* The open screen is part of the address (`#/app/<tab>`), so every tab can
     be linked to and the browser's back button — and Backspace — step back
     through the screens you actually visited. */
  const route = useRoute();
  /* An address naming a screen that doesn't exist opens the dashboard rather
     than a blank pane. */
  const routeTab = route.name === "app" && Object.hasOwn(SCREEN_FEATURE, route.param) ? route.param : "overview";
  const [rawTab, setTabState] = useState(routeTab);
  useEffect(() => { setTabState(routeTab); }, [routeTab]);


  const setTab = (next) => { setTabState(next); navigate(`app/${next}`); };

  const [palette, setPalette] = useState(false);
  const [pending, setPending] = useState("");
  const [pendingDoc, setPendingDoc] = useState(null);
  const [direction, setDirection] = useState(1);
  const [data, setData] = useState(null);
  const [staff, setStaff] = useState([]);
  const [lowStock, setLowStock] = useState([]);
  /* Dismissed as soon as it is answered, so the picker does not reappear
     while the fresh scope is still in flight. */
  const [typeAnswered, setTypeAnswered] = useState(false);
  const [savingType, setSavingType] = useState(false);
  const [typeError, setTypeError] = useState("");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  useAppFrame();
  const [noSales, setNoSales] = useState(false);
  /* The connected Loyverse, as the last metrics read found it (null: none). */
  const [till, setTill] = useState(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [dateRange, setDateRange] = useState("monthly");
  /* The user's authorization scope, from the server. `branches` is what the
     interface is asking for; empty means every branch they're allowed to see,
     the same convention the API uses. */
  const [scope, setScope] = useState(() => rememberedScope(user));

  /* What this person may open.

     The list is the server's answer, not the browser's: `/api/scope` resolves
     it from the same capabilities every data route checks, including any tab
     the owner has opened up for this role or this person. Deciding it here as
     well would give the nav and the API two opinions, and the one that draws
     a screen the other refuses to feed is the one people report as a bug.

     Until scope arrives, nothing but the tabs that need no permission — a
     brief empty nav is better than one that offers a tab and withdraws it.

     The one exception is the server's own last answer for this person, kept
     with the sign-in (`rememberedScope`): it is what the nav opens on, so
     that with no connection the register and the saved screens can still be
     reached, and it is replaced the moment the server answers again. */
  /* Tabs that need no permission at all — the assistant answers within
     whatever scope a person already has, the board is how the team reaches
     each other, and settings is their own account.

     Overview used to be on this list and is not a free tab: it leads with net
     margin. While scope was loading, and permanently if scope failed to load,
     a cashier saw it. A fallback has to be the safe answer rather than the
     convenient one. */
  /* Messages was here and the board is shelved, so it would have been a
     fallback to a tab nothing can open. */
  const OPEN_TABS = ["ask", "settings"];
  const allowedIds = scope?.tabs || OPEN_TABS;
  const allowed = (id) => allowedIds.includes(id);

  /* Capabilities, for the controls that are not tabs. Export is the only one
     so far, and it needed to exist: `allowed()` answers "may they open this
     screen", which is a different question from "may they take it away". */
  const can = (capability) => (scope?.capabilities || []).includes(capability);

  const canManageTeam = allowed("team");

  /* Importance order: today's numbers, the cost ledger, the assistant, then
     operations, then the analysis screens, then the team, with billing and
     settings last. */
  /* The nav, in the order the server put it in.

     `scope.tabs` arrives ordered by the kind of business this is — a cafe
     leads with selling and recipes, a home kitchen with recipes and costing.
     The set is identical either way; only the order differs, because a type
     promotes what leads and can never add or remove a tab.

     `ALL_TABS` still supplies the icon and is still the single list of what
     exists, so a tab the server permits but this build has never heard of is
     dropped rather than rendered as an undefined icon — which is exactly the
     crash the comment above that list describes. */
  /* Whether to ask what kind of business this is before showing anything.

     Every condition has to hold: the scope has loaded (so a null type is an
     answer and not just an unfinished request), this session is the one that
     just registered, nobody has answered yet, and this person can actually
     set it. */
  const typePrompt = Boolean(
    scope
    && justRegistered
    && !typeAnswered
    && scope.businessType === null
    && (scope.capabilities || []).includes("manage:users"),
  );

  const byId = Object.fromEntries(ALL_TABS.map((tb) => [tb.id, tb]));
  const navTabs = allowedIds.map((id) => byId[id]).filter(Boolean);

  /* Falling back to a fixed "overview" assumed everybody has it. Now that the
     dashboard is a profitability screen, a cashier's fallback has to be the
     first tab they actually hold — otherwise a stale bookmark lands them on a
     blank screen with no way to tell why. */
  const firstAllowed = navTabs[0]?.id || "settings";
  const tab = allowed(rawTab) ? rawTab : firstAllowed;

  const [branches, setBranches] = useState([]);
  const mainRef = useRef(null);
  /* The screen last open in each portal; see the portals section below. */
  const lastIn = useRef({});

  const [conversations, setConversations] = useState(() => listConversations(user));
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [account, setAccount] = useState(null);
  const [chatsOpen, setChatsOpen] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches);
  /* Back closes what is open before it moves between tabs. On a phone this is
     the difference between the gesture closing a menu and the gesture leaving
     the app from inside one. */
  useBackToClose(mobileMenu, useCallback(() => setMobileMenu(false), []));
  useBackToClose(chatsOpen, useCallback(() => setChatsOpen(false), []));
  useBackToClose(palette, useCallback(() => setPalette(false), []));
  const activeIdRef = useRef(null);

  const updateMessages = (next, { streaming = false } = {}) => {
    setMessages(next);
    if (!next.length) return;
    if (!activeIdRef.current) { activeIdRef.current = newId(); setActiveId(activeIdRef.current); }
    const id = activeIdRef.current;
    if (streaming) return;
    saveConversation(user, { id, messages: next });
    const list = listConversations(user);
    setConversations(list);
    const saved = list.find((c) => c.id === id);
    pushRemote(token, { id, title: saved?.title || "", messages: next });
  };

  const openConversation = (id) => {
    const c = getConversation(user, id);
    activeIdRef.current = id; setActiveId(id); setMessages(c?.messages || []); go("ask");
  };
  const startNewChat = () => { activeIdRef.current = null; setActiveId(null); setMessages([]); go("ask"); };
  const removeConversation = (id) => {
    deleteConversation(user, id); deleteRemote(token, id);
    setConversations(listConversations(user));
    if (id === activeId) { activeIdRef.current = null; setActiveId(null); setMessages([]); }
  };

  const index = TAB_META.findIndex((x) => x.id === tab);
  const go = (next) => {
    setMobileMenu(false); setExportOpen(false);
    if (next === tab) return;
    setDirection(TAB_META.findIndex((x) => x.id === next) >= index ? 1 : -1);
    setTab(next);
  };
  const step = (delta) => { const target = TAB_META[index + delta]; if (target) go(target.id); };

  async function load({ fresh = false, quiet = false } = {}) {
    if (!quiet) setError("");
    setRefreshing(true);
    try {
      const query = new URLSearchParams();
      if (fresh) query.set("fresh", "1");
      // Only sent when narrowed; the server treats an absent list as "all mine".
      if (branches.length) query.set("branches", branches.join(","));
      /* A range longer than 30 days is worked out on the server, over the
         register's own history. */
      const longPeriod = LONG_PERIODS[dateRange];
      if (longPeriod) query.set("period", longPeriod);
      const qs = query.toString();
      const res = await fetch(`/api/metrics${qs ? `?${qs}` : ""}`, { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      if (res.status === 402) return;
      /* 409: the register has not rung anything up yet. */
      if (res.status === 409) { setNoSales(true); setTill(json.pos || null); return; }
      if (!res.ok) throw new Error(json.error || t.watch.failedTitle);
      setNoSales(false); setTill(json.pos || null); setData(json); setFetchedAt(Date.now());
    } catch (err) { if (!quiet) setError(err.message || t.watch.failedTitle); }
    finally { setRefreshing(false); }
  }

  async function refreshEverything() { await loadAccount(); await loadScope(); await load(); }

  /* Saving carries the version the read came back with, so two people in
     settings at once produce a 409 rather than one silently overwriting the
     other. On a conflict the server sends back what the record now says;
     the scope is reloaded so the screen shows their choice rather than a
     stale one, and the message explains what happened. */
  async function saveBusinessType(type) {
    if (!type) return null;
    setSavingType(true);
    setTypeError("");
    try {
      const current = await fetch("/api/business", { headers: { Authorization: `Bearer ${token}` } });
      const before = await current.json().catch(() => ({}));

      const res = await fetch("/api/business", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type, expectedVersion: before.version }),
      });
      const json = await res.json().catch(() => ({}));

      if (res.status === 409) {
        await loadScope();
        setTypeError(t.businessType.errConflict);
        return null;
      }
      if (!res.ok) { setTypeError(t.businessType.errServer); return null; }

      setTypeAnswered(true);
      await loadScope();
      return json;
    } catch {
      setTypeError(t.businessType.errServer);
      return null;
    } finally {
      setSavingType(false);
    }
  }

  async function loadScope() {
    try {
      const res = await fetch("/api/scope", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const json = await res.json();
      setScope(json);
      /* Remembered on the device, so that with no connection the app still
         knows which screens this person has — above all the register, which
         must open offline. The server decides again the moment it can be
         asked, and enforces it on every request regardless. */
      rememberScope(user, json);
    } catch { /* no connection: what was remembered stands */ }
  }
  async function loadAccount() {
    try {
      const res = await fetch("/api/account", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      setAccount(await res.json());
    } catch { /* */ }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const remote = await fetchRemote(token);
      if (cancelled || !remote) return;
      const merged = merge(listConversations(user), remote);
      merged.forEach((c) => saveConversation(user, { id: c.id, messages: c.messages }));
      setConversations(listConversations(user));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const introShown = useRef(false);
  useEffect(() => {
    if (introShown.current || !account) return;
    if (justRegistered && entitlements(account).registered && !entitlements(account).any) {
      introShown.current = true; setTab("billing");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, justRegistered]);

  /* Today's arrivals, for the bell.

     Fetched here rather than on the staff screen, because the whole point of a
     notification is that it reaches somebody who is looking at something else.
     On the same timer as the dashboard and only for people who can manage
     staff — for everyone else the request is never made at all, rather than
     made and thrown away by a capability check in the browser. */
  async function loadStaff() {
    if (!scope?.capabilities?.includes("manage:staff")) return;
    try {
      const res = await fetch("/api/employees?what=roster", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const json = await res.json();
      const names = new Map((json.employees || []).map((e) => [e.id, e.name]));
      setStaff((json.today || []).map((p) => ({
        id: p.id, kind: p.kind, at: p.at, name: names.get(p.employeeId) || "",
      })));
    } catch { /* the bell simply carries one fewer thing */ }
  }

  useEffect(() => {
    let timer = 0;
    const both = (opts) => { load(opts); loadStaff(); };
    const tick = () => { if (document.visibilityState === "visible") both({ quiet: true }); timer = setTimeout(tick, POLL_MS); };
    timer = setTimeout(tick, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") both({ quiet: true }); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* And once as soon as the capability is known, so the first look at the bell
     after signing in is not empty until the first tick. */
  useEffect(() => { loadStaff(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope?.capabilities]);

  /* Back on a connection after working from what was saved: read it all
     again now rather than at the next tick. */
  const { offline } = useOffline();
  const wasOffline = useRef(false);
  useEffect(() => {
    if (wasOffline.current && !offline) { load({ quiet: true }); loadScope(); loadAccount(); }
    wasOffline.current = offline;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offline]);

  /* What is running low on the shelf, for the bell.

     Fetched here for the same reason arrivals are: a warning that the chicken
     has run out is for somebody looking at something else. Only for people
     who keep the stock and a business whose plan includes it; read when the
     app opens and every few minutes while it is on screen. */
  /* Bring the ledger up to date with the sales just read.

     After each read of the sales rather than on a timer, so it runs while
     somebody is looking at the numbers and never in the background against
     an account nobody is using. Idempotent by receipt id, so a refresh a
     minute later does nothing the second time. Not awaited — the dashboard
     should not wait on the ledger, and a failure here must not blank a screen
     that has already loaded.

     Only once the stores are known, and only for somebody who may change
     stock on a plan that has it. It used to fire from inside the sales read,
     which on the first load of every visit finishes before `/api/scope`
     does: it named no store and was refused, every time. And for a cashier
     or an accountant it was a refusal on every refresh for as long as the
     tab stayed open. */
  const depleteFor = (scope?.capabilities || []).includes("manage:inventory") && entitlements(account).has(SCREEN_FEATURE.inventory)
    ? (scope?.branches || []).map((b) => b.id).join("|")
    : "";
  useEffect(() => {
    if (!fetchedAt || !depleteFor) return;
    depleteFromSales(token, depleteFor.split("|"));
  }, [fetchedAt, depleteFor, token]);

  const stockFor = `${(scope?.capabilities || []).includes("view:inventory")}|${(scope?.branches || []).map((b) => b.id).join(",")}|${entitlements(account).has(SCREEN_FEATURE.inventory)}`;
  useEffect(() => {
    if (!stockFor.startsWith("true") || !stockFor.endsWith("true")) { setLowStock([]); return undefined; }
    let cancelled = false;
    const names = Object.fromEntries((scope?.branches || []).map((b) => [String(b.id), b.name]));
    const many = (scope?.branches || []).length > 1;
    const read = async () => {
      try {
        const res = await fetch("/api/stock?what=low", { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setLowStock((json.items || []).map((i) => ({ ...i, branchName: many ? names[i.branchId] || "" : "" })));
      } catch { /* the bell simply carries one fewer thing */ }
    };
    read();
    const timer = setInterval(() => { if (document.visibilityState === "visible") read(); }, STOCK_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, stockFor]);

  useEffect(() => { load(); loadAccount(); loadScope(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* A change of branch scope is a different question, so it refetches; so
     is moving to or between the long periods. The short ones are slices of
     the 30 days already loaded. */
  const firstScope = useRef(true);
  const periodAsked = LONG_PERIODS[dateRange] || "";
  useEffect(() => {
    if (firstScope.current) { firstScope.current = false; return; }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branches, periodAsked]);

  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA)$/.test(e.target?.tagName) || e.target?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((v) => !v); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= TAB_META.length) { e.preventDefault(); go(TAB_META[n - 1].id); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, tab]);

  useSwipe(mainRef, { enabled: !desktop, onNext: () => step(rtl ? -1 : 1), onPrev: () => step(rtl ? 1 : -1) });

  /* No figures at all: the register has not sold anything yet. */
  const unconnectedAccount = noSales;

  const noticedLine = (() => {
    const o = data?.observations?.[0]; if (!o) return "";
    const v = { ...o.values };
    if (o.id === "trend") v.dir = t.insights[o.tone === "good" ? "up" : "down"];
    if (o.id === "weekend") v.dir = t.insights[v.up ? "above" : "below"];
    return fill(t.insights[o.id], v);
  })();

  const ent = entitlements(account);
  const needed = SCREEN_FEATURE[tab];
  const locked = !ent.has(needed);

  let body;
  if (tab === "billing") { body = <Plans token={token} account={account} onChanged={refreshEverything} />; }
  else if (tab === "settings") {
    body = <Settings data={data || EMPTY_METRICS} user={user} onRefresh={() => load({ fresh: true })} refreshing={refreshing}
      token={token} conversationCount={conversations.length} account={account}
      onAccountChange={refreshEverything} onSeePlans={() => go("billing")} onSession={onSession} onLogout={onLogout}
      onPosChange={refreshEverything} />;
  } else if (tab === "team") { body = <Team token={token} />; }
  else if (tab === "employees") { body = <Employees token={token} branches={branches} />; }
  else if (tab === "messages") { body = <Messages token={token} />; }
  else if (locked) { body = <Locked feature={needed} onSeePlans={() => go("billing")} />; }
  /* No `pendingDoc` here any more. The cost screen is a typed ledger and has
     no scanner to hand a document to; documents route to Inventory or Recipes. */
  else if (tab === "costs") { body = <Costs token={token} />; }
  else if (tab === "sales") { body = <Sales token={token} branches={branches} />; }
  else if (tab === "channels") { body = <Channels token={token} />; }
  else if (tab === "inventory") { body = <Inventory token={token} pendingDoc={pendingDoc} onDocUsed={() => setPendingDoc(null)} />; }
  else if (tab === "recipes") { body = <Recipes token={token} pendingDoc={pendingDoc} onDocUsed={() => setPendingDoc(null)} />; }
  else if (tab === "variance") { body = <Variance token={token} branches={branches} />; }
  else if (tab === "alerts") { body = <Alerts token={token} branches={branches} />; }
  else if (tab === "plan") { body = <Plan token={token} branches={branches} />; }
  else if (tab === "ask") {
    body = <Ask token={token} wide={desktop && !chatsOpen} pending={pending} onPendingUsed={() => setPending("")}
      capabilities={scope?.capabilities}
      onRouteDoc={(route, extracted) => {
        /* The document has already been read by the time this fires. Hand the
           result across so the destination opens filled in rather than asking
           for the same file a second time. */
        setPendingDoc({ scanner: route.scanner, data: extracted, at: Date.now() });
        go(route.tab);
      }}
      messages={messages} onMessagesChange={updateMessages} data={unconnectedAccount ? null : data}
      noticedLine={unconnectedAccount ? "" : noticedLine} branches={branches} />;
  } else if (unconnectedAccount) { body = <EmptyTable pos={till} onOpenRegister={() => go("till")} onOpenSettings={() => go("settings")} />; }
  else if (!data && error) {
    body = (
      <div className="h-full flex items-center justify-center p-8">
        <div className="max-w-sm text-center">
          <p className="display font-bold text-lg mb-2">{t.watch.failedTitle}</p>
          <p className="text-sm mb-5" style={{ color: C.slate }}>{error}</p>
          <div className="flex flex-wrap gap-2 justify-center">
            <button onClick={load} className="gpill gpill-primary px-4 py-2 text-sm font-semibold">{t.common.tryAgain}</button>
            <button onClick={() => go("settings")} className="gpill gpill-ghost px-4 py-2 text-sm font-semibold">{t.settings.title}</button>
          </div>
        </div>
      </div>
    );
  } else if (!data) { body = <Skeleton />; }
  else if (tab === "overview") {
    body = <Overview data={data} dateRange={dateRange} onDateRangeChange={setDateRange}
      /* go("ask") as well as queueing it: without the navigation this set a
         question on a screen the person was not looking at, and the answer
         appeared later when they happened to open Ask. */
      onAsk={(q) => { startNewChat(); setPending(q); go("ask"); }}
      onOpenCosts={() => go("menu")} onGo={go} />;
  } else if (tab === "watch") { body = <Watch data={data} dateRange={dateRange} onDateRangeChange={setDateRange} />; }
  else if (tab === "menu") { body = <Menu data={data} token={token} onSaved={() => load({ fresh: true })} />; }
  else if (tab === "forecast") { body = <Forecast data={data} />; }
  else if (tab === "advice") { body = <Advice data={data} onAsk={(q) => { startNewChat(); setPending(q); go("ask"); }} />; }

  const content = (
    <Transition screenKey={tab} direction={direction}>
      <ErrorBoundary key={tab}>{body}</ErrorBoundary>
    </Transition>
  );


  const paletteEl = <CommandPalette open={palette} onClose={() => setPalette(false)} onGo={go}
    onAsk={(q) => { setPending(q); go("ask"); }} />;

  const liveDot = data && !unconnectedAccount && <LiveDot fetchedAt={fetchedAt} refreshing={refreshing} connected={data.connected} />;

  const labelFor = (id) => { const full = t[id]?.tab || id; return full.length > 12 ? full.split(/\s+/)[0] : full; };

  /* Only offered where it means something: more than one authorized branch. */
  const scopePicker = scope?.branches?.length > 1 && (
    <BranchScope branches={scope.branches} locked={scope.lockedBranches || []} orgName={scope.organization?.name || ""} selected={branches} onChange={setBranches} />
  );

  const logo = (
    <div className="flex items-center gap-2">
      <BrandMark size={34} />
      <span className="display font-bold text-lg grad-text">{t.name}</span>
    </div>
  );

  /* ---------------- Asked once, on the way in ----------------

     A business that has just registered and has not said what kind it is gets
     the question before the dashboard, because the answer decides what the
     dashboard leads with and asking afterwards means rearranging a screen
     somebody has already started reading.

     Only on the way in, and only for somebody who can actually set it. An
     existing business is never interrupted — `businessType` is null for every
     account that predates the question, and the nav keeps the order it has
     always had until somebody chooses in Settings. A member who cannot edit
     organization settings is not shown a choice they cannot make. */
  if (typePrompt) {
    return (
      <div className="h-screen overflow-y-auto" style={{ paddingTop: "var(--inset-top)", paddingBottom: "var(--inset-bottom)" }}>
        <BusinessTypePicker
          value={scope?.businessType ?? null}
          busy={savingType}
          error={typeError}
          onContinue={saveBusinessType}
        />
      </div>
    );
  }

  /* ---------------- Portals ----------------

     Which portal is open follows the screen, and each portal remembers the
     screen last used in it, so going to the Kitchen and back to Business
     returns to Sales rather than to the top of Business. */
  const layout = layoutFor(allowedIds);
  const portalId = portalOf(tab) || layout[0]?.id || "business";
  const portal = layout.find((p) => p.id === portalId) || null;
  if (portalId !== "register") lastIn.current[portalId] = tab;
  if (portalId !== "register") lastIn.current.backOffice = tab;
  const pickPortal = (id) => {
    if (id === "register") return go("till");
    go(lastIn.current[id] && layout.find((p) => p.id === id)?.primary.concat(layout.find((p) => p.id === id)?.more || []).includes(lastIn.current[id])
      ? lastIn.current[id]
      : landingOf(layout, id) || firstAllowed);
  };
  const isLocked = (id) => !entitlements(account).has(SCREEN_FEATURE[id]);
  const accountTabs = ACCOUNT.filter((id) => allowed(id));

  /* The register is its own app: full screen, its own controls, and a way
     back to wherever the back office was left. */
  if (tab === "till") {
    return (
      <>
        <RegisterApp token={token} user={user} business={account?.account?.business || scope?.organization?.name || ""}
          onExit={() => go(lastIn.current.backOffice && lastIn.current.backOffice !== "till" ? lastIn.current.backOffice : firstAllowed === "till" ? "settings" : firstAllowed)}
          onLogout={onLogout} onSession={onSession} portals={layout} onPortal={pickPortal} />
      </>
    );
  }

  const exportButton = data && !unconnectedAccount && can("export") && (
    <div className="relative">
      <button onClick={() => setExportOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold"
        style={{ background: "var(--chip-bg)", color: C.ink }}>
        <Download size={14} />{t.export.title}<ChevronDown size={12} style={{ color: C.slate }} />
      </button>
      {exportOpen && <ExportMenu data={data} screen={tab} dateRange={dateRange}
        business={account?.account?.business} onClose={() => setExportOpen(false)} />}
    </div>
  );

  /* ---------------- Desktop ---------------- */
  if (desktop) {
    return (
      <div className="h-screen flex flex-col" style={{ paddingBottom: "var(--inset-bottom)" }}>
        <AmbientBackground />
        <header className="shrink-0 relative z-20" style={{ background: "var(--panel-glass)", backdropFilter: "blur(20px)", paddingTop: "var(--inset-top)" }}>
          <div className="h-16 flex items-center gap-5 px-6">
            {logo}
            <PortalSwitcher layout={layout} current={portalId} onPick={pickPortal} compact />
            <div className="flex-1" />
            {scopePicker}
            {liveDot}
            <button onClick={() => setPalette(true)} className="flex items-center gap-2 px-3 py-2 rounded-full text-xs"
              style={{ background: "var(--chip-bg)", color: C.slate }}>
              <Search size={13} /><span>{t.palette.open}</span>
              <kbd className="data text-[10px] px-1.5 rounded" dir="ltr">⌘K</kbd>
            </button>
            {exportButton}
            <NotificationBell data={data} staff={staff} stock={lowStock} capabilities={scope?.capabilities} onAsk={(q) => { startNewChat(); setPending(q); go("ask"); }} />
            <AccountMenu user={user} business={account?.account?.business} onGo={go} onLogout={onLogout} items={accountTabs} locked={isLocked} />
          </div>
          <SectionTabs portal={portal} tab={tab} onGo={go} locked={isLocked} />
        </header>
        <OfflineBanner />
        <TillBanner pos={till} onOpen={() => go("settings")} />
        <div className="flex-1 min-h-0 flex relative z-10" style={{ flexDirection: rtl ? "row-reverse" : "row" }}>
          <main className="flex-1 min-w-0 overflow-hidden relative">{content}</main>
          {tab === "ask" && (
            <div className="shrink-0 overflow-hidden" style={{ width: chatsOpen ? 256 : 44, borderInlineStart: `1px solid ${C.hairline}` }}>
              {chatsOpen ? (
                <ChatSidebar conversations={conversations} activeId={activeId}
                  onSelect={openConversation} onNew={startNewChat} onDelete={removeConversation} online={Boolean(data)} />
              ) : null}
              <button onClick={() => setChatsOpen((v) => !v)} className="absolute bottom-4 p-2 rounded-full"
                style={{ insetInlineEnd: 8, background: "var(--chip-bg)", color: C.slate }} aria-label={t.chats.title}>
                {chatsOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
              </button>
            </div>
          )}
        </div>
        {paletteEl}
      </div>
    );
  }

  /* ---------------- Phone ---------------- */
  const mobileExport = data && !unconnectedAccount && can("export") && (
    <div className="mx-4 mb-3 flex gap-2">
      <button onClick={() => { exportPDF(tab, data, dateRange, account?.account?.business); setMobileMenu(false); }}
        className="flex-1 gpill gpill-primary py-2.5 text-sm font-semibold flex items-center justify-center gap-2">
        <FileText size={15} /> PDF
      </button>
      <button onClick={() => { exportCSV(tab, data, dateRange, account?.account?.business); setMobileMenu(false); }}
        className="flex-1 gpill gpill-ghost py-2.5 text-sm font-semibold flex items-center justify-center gap-2">
        <Table size={15} /> CSV
      </button>
    </div>
  );

  return (
    <div className="h-screen flex flex-col relative overflow-hidden" style={{ background: C.bone }}>
      <header className="shrink-0 z-20" style={{ background: "var(--panel-glass)", backdropFilter: "blur(20px)", paddingTop: "var(--inset-top)" }}>
        <div className="h-12 flex items-center justify-between px-3 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <BrandMark size={28} />
            <span className="display font-bold text-base truncate-safe">{t[tab]?.tab || t.name}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {liveDot}
            <NotificationBell data={data} staff={staff} stock={lowStock} capabilities={scope?.capabilities} onAsk={(q) => { startNewChat(); setPending(q); go("ask"); }} />
            {tab === "ask" && (
              <button onClick={() => setChatsOpen(true)} className="p-2.5 rounded-full" style={{ color: C.slate }} aria-label={t.chats.title}>
                <MessageSquare size={19} />
              </button>
            )}
          </div>
        </div>
        <PortalSwitcher layout={layout} current={portalId} onPick={pickPortal} />
        {scopePicker && <div className="px-3 pb-2">{scopePicker}</div>}
      </header>
      <OfflineBanner />
      <TillBanner pos={till} onOpen={() => go("settings")} />
      <main className="flex-1 min-h-0 overflow-hidden relative">
        <AmbientBackground />
        <div className="relative z-10 h-full">{content}</div>
      </main>
      <BottomBar portal={portal} tab={tab} onGo={go} icons={TAB_ICONS} onMore={() => setMobileMenu((v) => !v)} moreOpen={mobileMenu} />
      <MoreSheet open={mobileMenu} onClose={() => setMobileMenu(false)} portal={portal} tab={tab} onGo={go} icons={TAB_ICONS}
        locked={isLocked} account={accountTabs} extra={mobileExport} onLogout={onLogout} user={user} />
      {chatsOpen && tab === "ask" && (
        <div className="fixed inset-0 z-50 flex" style={{ background: C.scrim, flexDirection: rtl ? "row-reverse" : "row" }}
          onClick={() => setChatsOpen(false)}>
          <div className="flex-1" />
          <div className="w-72 max-w-[82vw] palette-in" style={{ borderLeft: `1px solid ${C.hairline}` }} onClick={(e) => e.stopPropagation()}>
            <ChatSidebar conversations={conversations} activeId={activeId}
              onSelect={(id) => { openConversation(id); setChatsOpen(false); }}
              onNew={() => { startNewChat(); setChatsOpen(false); }} onDelete={removeConversation} online={Boolean(data)} />
          </div>
        </div>
      )}
      {paletteEl}
    </div>
  );
}
