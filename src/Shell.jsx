import { useCallback, useEffect, useRef, useState } from "react";
import {
  BarChart3, LineChart, MessageSquare, Settings as Cog, UtensilsCrossed, Users,
  Search, Lightbulb, PanelRightClose, PanelRightOpen, LogOut, Lock, Wallet,
  LayoutDashboard, Download, FileText, Table, ChevronDown, Package, ChefHat, Scale, BellRing, ShoppingCart, Camera, MessagesSquare,} from "lucide-react";
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
import Greeting from "./Greeting.jsx";
import ChatSidebar from "./ChatSidebar.jsx";
import Forecast from "./screens/Forecast.jsx";
import Settings from "./screens/Settings.jsx";
import Team from "./screens/Team.jsx";
import Messages from "./screens/Messages.jsx";
import Inventory from "./screens/Inventory.jsx";
import Recipes from "./screens/Recipes.jsx";
import Variance from "./screens/Variance.jsx";
import Alerts from "./screens/Alerts.jsx";
import Plan from "./screens/Plan.jsx";
import Costs from "./screens/Costs.jsx";
import BranchScope from "./BranchScope.jsx";
import CommandPalette from "./CommandPalette.jsx";
import LanguagePicker from "./LanguagePicker.jsx";
import ThemeToggle from "./ThemeToggle.jsx";
import Skeleton from "./Skeleton.jsx";
import { ConnectDialog, EmptyTable } from "./Connect.jsx";
import LiveDot from "./LiveDot.jsx";
import MobileShell from "./MobileShell.jsx";
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

/* Ordered by importance: the numbers you check first, the AI bill scanner a
   cashier lives in, then analysis, with account plumbing last. */
const TAB_META = [
  { id: "overview", icon: LayoutDashboard },
  { id: "costs", icon: Camera },
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

const TAB_ICONS = Object.fromEntries([...TAB_META, INVENTORY_TAB, ALERTS_TAB, PLAN_TAB, RECIPES_TAB, VARIANCE_TAB, TEAM_TAB, MESSAGES_TAB].map((tb) => [tb.id, tb.icon]));

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
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [needsPos, setNeedsPos] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [dateRange, setDateRange] = useState("monthly");
  /* The user's authorization scope, from the server. `branches` is what the
     interface is asking for; empty means every branch they're allowed to see,
     the same convention the API uses. */
  const [scope, setScope] = useState(null);

  /* What this person may open.

     The list is the server's answer, not the browser's: `/api/scope` resolves
     it from the same capabilities every data route checks, including any tab
     the owner has opened up for this role or this person. Deciding it here as
     well would give the nav and the API two opinions, and the one that draws
     a screen the other refuses to feed is the one people report as a bug.

     Until scope arrives, nothing but the tabs that need no permission — a
     brief empty nav is better than one that offers a tab and withdraws it. */
  /* Tabs that need no permission at all — the assistant answers within
     whatever scope a person already has, the board is how the team reaches
     each other, and settings is their own account.

     Overview used to be on this list and is not a free tab: it leads with net
     margin. While scope was loading, and permanently if scope failed to load,
     a cashier saw it. A fallback has to be the safe answer rather than the
     convenient one. */
  const OPEN_TABS = ["ask", "messages", "settings"];
  const allowedIds = scope?.tabs || OPEN_TABS;
  const allowed = (id) => allowedIds.includes(id);

  /* Capabilities, for the controls that are not tabs. Export is the only one
     so far, and it needed to exist: `allowed()` answers "may they open this
     screen", which is a different question from "may they take it away". */
  const can = (capability) => (scope?.capabilities || []).includes(capability);

  const canManageTeam = allowed("team");

  /* Importance order: today's numbers, the bill scanner, the assistant, then
     operations, then the analysis screens, then the team, with billing and
     settings last. */
  const byId = Object.fromEntries(TAB_META.map((tb) => [tb.id, tb]));
  const navTabs = [
    byId.overview, byId.costs, byId.ask,
    INVENTORY_TAB, ALERTS_TAB, PLAN_TAB, RECIPES_TAB, VARIANCE_TAB,
    byId.watch, byId.menu, byId.forecast, byId.advice,
    MESSAGES_TAB, TEAM_TAB,
    byId.billing, byId.settings,
  ].filter((tb) => tb && allowed(tb.id));

  /* Falling back to a fixed "overview" assumed everybody has it. Now that the
     dashboard is a profitability screen, a cashier's fallback has to be the
     first tab they actually hold — otherwise a stale bookmark lands them on a
     blank screen with no way to tell why. */
  const firstAllowed = navTabs[0]?.id || "settings";
  const tab = allowed(rawTab) ? rawTab : firstAllowed;

  const [branches, setBranches] = useState([]);
  const mainRef = useRef(null);

  const [conversations, setConversations] = useState(() => listConversations(user));
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [account, setAccount] = useState(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [skipped, setSkipped] = useState(() => {
    try { return localStorage.getItem(`sufra_pos_skipped_${user}`) === "1"; } catch { return false; }
  });
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
      const qs = query.toString();
      const res = await fetch(`/api/metrics${qs ? `?${qs}` : ""}`, { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      if (res.status === 402) return;
      if (res.status === 409) { setNeedsPos(true); return; }
      if (res.status === 502) { if (!quiet) setError(json.detail || t.connect.failed); return; }
      if (!res.ok) throw new Error(json.error || t.watch.failedTitle);
      setNeedsPos(false); setData(json); setFetchedAt(Date.now());

      /* Bring the ledger up to date with the sales just read.

         Fired here rather than on a timer, so it runs while somebody is
         looking at the numbers and never in the background against an account
         nobody is using. Idempotent by receipt id, so a refresh a minute later
         does nothing the second time. Deliberately not awaited — the dashboard
         should not wait on the ledger, and a failure here must not blank a
         screen that has already loaded. */
      depleteFromSales(token, scope?.branches);
    } catch (err) { if (!quiet) setError(err.message || t.watch.failedTitle); }
    finally { setRefreshing(false); }
  }

  async function refreshEverything() { await loadAccount(); await loadScope(); await load(); }

  async function loadScope() {
    try {
      const res = await fetch("/api/scope", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      setScope(await res.json());
    } catch { /* the dashboard still works; it just won't offer a selector */ }
  }
  async function loadAccount() {
    try {
      const res = await fetch("/api/account", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const json = await res.json(); setAccount(json);
      /* Only the person who can actually connect a till gets the prompt. A
         member reads through the owner's connection, so pushing them at a
         connect screen would be asking a cashier for a credential they have no
         way to obtain and no business holding. */
      const shouldPrompt = json.account
        && json.pos?.canConnect !== false
        && !json.pos?.connected
        && !json.account.posConnected
        && !json.serverToken;
      if (shouldPrompt && (justRegistered || !skipped)) setConnectOpen(true);
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

  useEffect(() => {
    let timer = 0;
    const tick = () => { if (document.visibilityState === "visible") load({ quiet: true }); timer = setTimeout(tick, POLL_MS); };
    timer = setTimeout(tick, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") load({ quiet: true }); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); loadAccount(); loadScope(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* A change of branch scope is a different question, so it refetches. */
  const firstScope = useRef(true);
  useEffect(() => {
    if (firstScope.current) { firstScope.current = false; return; }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branches]);

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

  /* Only a genuine "no figures at all" state (the 409 the API used to return
     when nothing was connected) hides the dashboard. With sample data served
     for unconnected accounts, the table renders and is simply labelled as
     demo rather than live. */
  const unconnectedAccount = needsPos;

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
      token={token} conversationCount={conversations.length} account={account} onConnect={() => setConnectOpen(true)}
      onAccountChange={refreshEverything} onSeePlans={() => go("billing")} onSession={onSession} onLogout={onLogout} />;
  } else if (tab === "team") { body = <Team token={token} />; }
  else if (tab === "messages") { body = <Messages token={token} />; }
  else if (locked) { body = <Locked feature={needed} onSeePlans={() => go("billing")} />; }
  else if (tab === "costs") { body = <Costs token={token} pendingDoc={pendingDoc} onDocUsed={() => setPendingDoc(null)} />; }
  else if (tab === "inventory") { body = <Inventory token={token} pendingDoc={pendingDoc} onDocUsed={() => setPendingDoc(null)} />; }
  else if (tab === "recipes") { body = <Recipes token={token} pendingDoc={pendingDoc} onDocUsed={() => setPendingDoc(null)} />; }
  else if (tab === "variance") { body = <Variance token={token} branches={branches} />; }
  else if (tab === "alerts") { body = <Alerts token={token} branches={branches} />; }
  else if (tab === "plan") { body = <Plan token={token} branches={branches} />; }
  else if (tab === "ask") {
    body = <Ask token={token} wide={desktop && !chatsOpen} pending={pending} onPendingUsed={() => setPending("")}
      onRouteDoc={(route, extracted) => {
        /* The document has already been read by the time this fires. Hand the
           result across so the destination opens filled in rather than asking
           for the same file a second time. */
        setPendingDoc({ scanner: route.scanner, data: extracted, at: Date.now() });
        go(route.tab);
      }}
      messages={messages} onMessagesChange={updateMessages} data={unconnectedAccount ? null : data}
      noticedLine={unconnectedAccount ? "" : noticedLine} branches={branches} />;
  } else if (unconnectedAccount) { body = <EmptyTable onConnect={() => setConnectOpen(true)} />; }
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
      onAsk={(q) => { startNewChat(); setPending(q); }} onOpenCosts={() => go("menu")} onGo={go} />;
  } else if (tab === "watch") { body = <Watch data={data} dateRange={dateRange} onDateRangeChange={setDateRange} />; }
  else if (tab === "menu") { body = <Menu data={data} token={token} onSaved={() => load({ fresh: true })} />; }
  else if (tab === "forecast") { body = <Forecast data={data} />; }
  else if (tab === "advice") { body = <Advice data={data} onAsk={(q) => { startNewChat(); setPending(q); }} />; }

  const content = (
    <Transition screenKey={tab} direction={direction}>
      <ErrorBoundary key={tab}>{body}</ErrorBoundary>
    </Transition>
  );

  const connectEl = <ConnectDialog open={connectOpen} token={token}
    onClose={() => { setConnectOpen(false); setSkipped(true); try { localStorage.setItem(`sufra_pos_skipped_${user}`, "1"); } catch { /* */ } }}
    onConnected={() => { setConnectOpen(false); refreshEverything(); }} />;

  const paletteEl = <CommandPalette open={palette} onClose={() => setPalette(false)} onGo={go}
    onAsk={(q) => { setPending(q); go("ask"); }} />;

  const liveDot = data && !unconnectedAccount && <LiveDot fetchedAt={fetchedAt} refreshing={refreshing} connected={data.connected} />;

  const labelFor = (id) => { const full = t[id]?.tab || id; return full.length > 12 ? full.split(/\s+/)[0] : full; };

  /* Only offered where it means something: more than one authorized branch. */
  const scopePicker = scope?.branches?.length > 1 && (
    <BranchScope branches={scope.branches} selected={branches} onChange={setBranches} />
  );

  const logo = (
    <div className="flex items-center gap-2">
      <BrandMark size={34} />
      <span className="display font-bold text-lg grad-text">{t.name}</span>
    </div>
  );

  /* ---------------- Desktop ---------------- */
  if (desktop) {
    return (
      <div className="h-screen flex" style={{ flexDirection: rtl ? "row-reverse" : "row" }}>
        <AmbientBackground />
        <main className="flex-1 min-w-0 overflow-hidden relative z-10">{content}</main>

        {tab === "ask" && chatsOpen && (
          <div className="w-64 shrink-0 overflow-hidden relative z-10" style={{ borderLeft: `1px solid ${C.hairline}` }}>
            <ChatSidebar conversations={conversations} activeId={activeId}
              onSelect={openConversation} onNew={startNewChat} onDelete={removeConversation} online={Boolean(data)} />
          </div>
        )}

        <aside className="w-60 shrink-0 flex flex-col p-4 rail-in relative z-10"
          style={{ background: "var(--panel-glass)", backdropFilter: "blur(20px)", borderLeft: `1px solid ${C.hairline}` }}>
          <div className="mb-5 px-1">{logo}</div>
          <div className="mb-5 px-1"><Greeting user={user} business={account?.account?.business} /></div>

          <nav className="flex flex-col gap-1 relative flex-1">
            {navTabs.map(({ id, icon: Icon }) => {
              const on = tab === id;
              return (
                <button key={id} onClick={() => go(id)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all relative"
                  style={{
                    background: on ? "linear-gradient(135deg, rgba(139,92,246,0.18) 0%, rgba(6,182,212,0.08) 100%)" : "transparent",
                    color: on ? C.ink : C.slate,
                    boxShadow: on ? "inset 0 0 0 1px rgba(139,92,246,0.2)" : "none",
                  }}>
                  <Icon size={17} />
                  <span className="flex-1 text-start">{t[id]?.tab || id}</span>
                  {!entitlements(account).has(SCREEN_FEATURE[id]) && <Lock size={12} style={{ color: C.slate }} />}
                </button>
              );
            })}
          </nav>

          <div className="mt-auto px-1 space-y-3 pt-3">
            {tab === "ask" && (
              <button onClick={() => setChatsOpen((v) => !v)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold"
                style={{ border: `1px solid ${C.hairline}`, color: C.slate }}>
                {chatsOpen ? <PanelRightClose size={13} /> : <PanelRightOpen size={13} />}
                <span className="flex-1 text-start">{t.chats.title}</span>
                <span className="data text-[10px]" dir="ltr">{conversations.length}</span>
              </button>
            )}
            <button onClick={() => setPalette(true)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs"
              style={{ border: `1px solid ${C.hairline}`, color: C.slate }}>
              <Search size={13} /><span className="flex-1 text-start">{t.palette.open}</span>
              <kbd className="data text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--chip-bg)" }} dir="ltr">⌘K</kbd>
            </button>

            {scopePicker}

            {/* Export.

                The `export` capability has existed since the roles were
                written and nothing ever checked it. A cashier could take the
                whole dashboard away as a PDF — every figure their role is
                barred from seeing on screen, in a file, off the premises. The
                nav gating was doing real work and this button quietly went
                round it.

                Gated on the capability rather than on a role list, so it
                follows the same rule as everything else and an owner granting
                a tab does not accidentally grant the ability to export it. */}
            {data && !unconnectedAccount && can("export") && (
              <div className="relative">
                <button onClick={() => setExportOpen((v) => !v)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold"
                  style={{ background: "linear-gradient(135deg, rgba(139,92,246,0.12), rgba(6,182,212,0.06))", border: "1px solid rgba(139,92,246,0.2)", color: C.ink }}>
                  <Download size={14} /><span className="flex-1 text-start">{t.export.title}</span>
                  <ChevronDown size={12} style={{ color: C.slate }} />
                </button>
                {exportOpen && <ExportMenu data={data} screen={tab} dateRange={dateRange}
                  business={account?.account?.business} onClose={() => setExportOpen(false)} />}
              </div>
            )}

            <div className="flex items-center gap-2">
              <LanguagePicker /><ThemeToggle compact />
              <NotificationBell data={data} capabilities={scope?.capabilities} onAsk={(q) => { startNewChat(); setPending(q); go("ask"); }} />
            </div>
            <div className="flex items-center justify-between gap-2 pt-3" style={{ borderTop: `1px solid ${C.hairline}` }}>
              <span className="text-xs truncate" style={{ color: C.slate }}>
                {t.settings.signedInAs} <span className="font-medium">{user || "—"}</span>
              </span>
              <button onClick={onLogout} className="shrink-0 p-1.5 rounded-lg" style={{ color: C.rose }}
                aria-label={t.common.signOut} title={t.common.signOut}>
                <LogOut size={15} className="flip-rtl" />
              </button>
            </div>
          </div>
        </aside>
        {paletteEl}{connectEl}
      </div>
    );
  }

  /* ---------------- Mobile ---------------- */
  const mobileSheet = mobileMenu && (
    <div className="absolute inset-0 z-40" style={{ background: C.scrim }} onClick={() => setMobileMenu(false)}
      role="presentation">
      {/* A drawer off the trailing edge rather than a lid over a bottom bar.

          `inset-inline-end` is the whole reason this needs no second layout for
          Arabic: it resolves to the right in a left-to-right page and the left
          in a right-to-left one, which is the same edge in both — the one the
          thumb holding the phone reaches. A hardcoded `right-0` would have put
          the Arabic drawer under the user's palm. */}
      <div className="absolute inset-y-0 w-[82%] max-w-[330px] overflow-y-auto p-4 space-y-4 drawer-in"
        style={{ insetInlineEnd: 0, background: "var(--panel-solid)", backdropFilter: "blur(20px)",
          borderInlineStart: `1px solid ${C.hairline}`,
          paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}
        onClick={(e) => e.stopPropagation()}
        role="menu" aria-label={t.nav.menu}>
        <Greeting user={user} business={account?.account?.business} />
        {scopePicker}
        {/* Every tab, in nav order, with no second tier. The bottom bar's
            hand-written list of five had already gone stale once — Bill scan,
            a cashier's whole shift, was in neither list and unreachable on a
            phone. One list that comes from the nav cannot drift from it. */}
        <div className="flex flex-col gap-1" role="none">
          {navTabs.map(({ id }) => {
            const Icon = TAB_ICONS[id]; const on = tab === id;
            const locked = !entitlements(account).has(SCREEN_FEATURE[id]);
            return (
              <button key={id} onClick={() => go(id)} role="menuitem"
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-start"
                style={{
                  minHeight: 48,
                  color: on ? C.iris : C.ink,
                  background: on ? C.irisWash : "transparent",
                }}
                aria-current={on ? "page" : undefined}>
                <Icon size={19} strokeWidth={on ? 2.3 : 1.8} className="shrink-0" />
                <span className="text-sm font-medium truncate-safe flex-1">{t[id].tab}</span>
                {locked && <Lock size={12} style={{ color: C.slate }} className="shrink-0" />}
              </button>
            );
          })}
        </div>
        {/* Export on mobile */}
        {data && !unconnectedAccount && (
          <div className="flex gap-2">
            <button onClick={() => { exportPDF(tab, data, dateRange, account?.account?.business); setMobileMenu(false); }}
              className="flex-1 gpill gpill-primary py-2.5 text-sm font-semibold flex items-center justify-center gap-2">
              <FileText size={15} /> PDF
            </button>
            <button onClick={() => { exportCSV(tab, data, dateRange, account?.account?.business); setMobileMenu(false); }}
              className="flex-1 gpill gpill-ghost py-2.5 text-sm font-semibold flex items-center justify-center gap-2">
              <Table size={15} /> CSV
            </button>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <span className="micro" style={{ color: C.slate }}>{t.settings.language}</span><LanguagePicker />
        </div>
        <div><div className="micro mb-2" style={{ color: C.slate }}>{t.theme.label}</div><ThemeToggle /></div>
        <button onClick={onLogout} className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold"
          style={{ border: `1px solid ${C.hairline}`, color: C.rose }}>
          <LogOut size={15} className="flip-rtl" /> {t.common.signOut}
        </button>
      </div>
    </div>
  );

  return (
    <MobileShell tab={tab} go={go} tabIcons={TAB_ICONS} labelFor={labelFor} liveDot={liveDot}
      onOpenChats={() => setChatsOpen(true)} onOpenMenu={() => setMobileMenu((v) => !v)} menuOpen={mobileMenu} sheet={mobileSheet}
      bell={<NotificationBell data={data} capabilities={scope?.capabilities} onAsk={(q) => { startNewChat(); setPending(q); go("ask"); }} />}
      /* Shown once there is somewhere to go back to. The landing tab is
         whatever this person's role opens on, so back from there would leave
         the app — which is the browser's job, not a button in our header. */
      canGoBack={tab !== firstAllowed}
      onBack={() => window.history.back()}>
      <AmbientBackground />
      <div className="relative z-10 h-full">{content}</div>
      {!desktop && chatsOpen && tab === "ask" && (
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
      {paletteEl}{connectEl}
    </MobileShell>
  );
}
