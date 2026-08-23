import { useEffect, useRef, useState } from "react";
import {
  BarChart3, LineChart, MessageSquare, Settings as Cog, UtensilsCrossed, Search, Lightbulb, PanelRightClose, PanelRightOpen, LogOut, Lock, Wallet, LayoutDashboard,
} from "lucide-react";
import { useC } from "./theme.jsx";
import NeonMark from "./NeonMark.jsx";
import { useLang, fill } from "./i18n.jsx";
import { useSwipe } from "./hooks-nav.js";
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
import CommandPalette from "./CommandPalette.jsx";
import LanguagePicker from "./LanguagePicker.jsx";
import ThemeToggle from "./ThemeToggle.jsx";
import Skeleton from "./Skeleton.jsx";
import { ConnectDialog, EmptyTable } from "./Connect.jsx";
import LiveDot from "./LiveDot.jsx";
import MobileShell, { SECONDARY } from "./MobileShell.jsx";
import Plans, { Locked } from "./screens/Plans.jsx";
import { entitlements, SCREEN_FEATURE } from "./entitlements.js";
import Transition from "./Transition.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";

/* Settings renders before the dashboard figures exist — and must render even
   if they never arrive — so it gets a correctly-shaped blank rather than a
   pile of optional-chaining at every read site. */
const EMPTY_METRICS = {
  connected: false,
  source: "—",
  currency: "AED",
  stores: [],
  items: [],
  hours: [],
  daily: [],
  payments: [],
  observations: [],
  advice: [],
  totals: { sales: 0, receipts: 0, avgTicket: 0, salesDelta: 0, receiptsDelta: 0, avgTicketDelta: 0, peakHour: "—" },
  forecast: { conservative: 0, base: 0, optimistic: 0, series: [] },
  menu: { items: [], medianQty: 0, medianPerUnit: 0 },
  extras: { discounts: 0, refunds: 0, cost: 0 },
  updatedAt: null,
};

/* Rail geometry, in one place.

   The indicator used to step 52px while the buttons sat 56px apart — the nav
   had a 4px gap *and* each button carried a 4px bottom margin, so the two
   spacings disagreed and the highlight drifted further out with every tab.
   Deriving both from the same numbers means they can't disagree again. */
const POLL_MS = 30 * 1000;


const RAIL_ITEM = 46;
const RAIL_GAP = 4;
const RAIL_PITCH = RAIL_ITEM + RAIL_GAP;
const RAIL_PAD = 12;

const TAB_META = [
  { id: "overview", icon: LayoutDashboard },
  { id: "ask", icon: MessageSquare },
  { id: "watch", icon: BarChart3 },
  { id: "menu", icon: UtensilsCrossed },
  { id: "forecast", icon: LineChart },
  { id: "advice", icon: Lightbulb },
  { id: "billing", icon: Wallet },
  { id: "settings", icon: Cog },
];

const TAB_ICONS = Object.fromEntries(TAB_META.map((tb) => [tb.id, tb.icon]));

function useDesktop() {
  const [big, setBig] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = (e) => setBig(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return big;
}

export default function Shell({ token, user, onLogout, onSession, justRegistered = false }) {
  const C = useC();
  const { t, rtl } = useLang();
  const desktop = useDesktop();
  const [tab, setTab] = useState("overview");
  const [palette, setPalette] = useState(false);
  const [pending, setPending] = useState("");
  const [direction, setDirection] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [needsPos, setNeedsPos] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(null);
  const mainRef = useRef(null);

  /* Chat memory. The active thread lives in state; every change is written
     through to storage so a reload or a tab switch loses nothing. */
  const [conversations, setConversations] = useState(() => listConversations(user));
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  /* Desktop opens with the column visible; touch opens with the drawer shut,
     since a drawer over the chat on load would be in the way. */
  /* A fresh account lands on an empty table with the connect prompt over it.
     Dismissing is remembered, so it asks once rather than every visit. */
  const [account, setAccount] = useState(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [skipped, setSkipped] = useState(() => {
    try {
      return localStorage.getItem(`sufra_pos_skipped_${user}`) === "1";
    } catch {
      return false;
    }
  });

  const [chatsOpen, setChatsOpen] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches
  );

  /* Written locally first so the interface never waits on the network,
     then pushed to the account if a database is attached. */
  /* The id lives in a ref as well as in state.

     `activeId` is state, so it is still null on every call until React
     re-renders. During streaming that meant every token minted a fresh
     conversation — one question produced a dozen entries in the sidebar.
     A ref updates synchronously, so the whole exchange keeps one id. */
  const activeIdRef = useRef(null);

  const updateMessages = (next, { streaming = false } = {}) => {
    setMessages(next);
    if (!next.length) return;

    if (!activeIdRef.current) {
      activeIdRef.current = newId();
      setActiveId(activeIdRef.current);
    }
    const id = activeIdRef.current;

    /* Mid-stream, only the transcript in memory changes. Writing to storage
       and re-reading the whole list on every token is what made typing feel
       choppy, and none of it survives the next token anyway. */
    if (streaming) return;

    saveConversation(user, { id, messages: next });
    const list = listConversations(user);
    setConversations(list);
    const saved = list.find((c) => c.id === id);
    pushRemote(token, { id, title: saved?.title || "", messages: next });
  };

  const openConversation = (id) => {
    const c = getConversation(user, id);
    activeIdRef.current = id;
    setActiveId(id);
    setMessages(c?.messages || []);
    go("ask");
  };

  const startNewChat = () => {
    activeIdRef.current = null;
    setActiveId(null);
    setMessages([]);
    go("ask");
  };

  const removeConversation = (id) => {
    deleteConversation(user, id);
    deleteRemote(token, id);
    setConversations(listConversations(user));
    if (id === activeId) {
      activeIdRef.current = null;
      setActiveId(null);
      setMessages([]);
    }
  };

  const index = TAB_META.findIndex((x) => x.id === tab);

  const go = (next) => {
    setMobileMenu(false);
    if (next === tab) return;
    setDirection(TAB_META.findIndex((x) => x.id === next) >= index ? 1 : -1);
    setTab(next);
  };

  const step = (delta) => {
    const target = TAB_META[index + delta];
    if (target) go(target.id);
  };

  async function load({ fresh = false, quiet = false } = {}) {
    if (!quiet) setError("");
    setRefreshing(true);
    try {
      const res = await fetch(`/api/metrics${fresh ? "?fresh=1" : ""}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();

      // The package isn't owned. The locked screen already explains that.
      if (res.status === 402) return;

      // No POS connected. Not a failure — there is simply nothing to show yet.
      if (res.status === 409) {
        setNeedsPos(true);
        return;
      }

      // A POS is connected but couldn't be read. Show why.
      if (res.status === 502) {
        // A background poll shouldn't replace the screen with an error.
        if (!quiet) setError(json.detail || t.connect.failed);
        return;
      }

      if (!res.ok) throw new Error(json.error || t.watch.failedTitle);
      setNeedsPos(false);
      setData(json);
      setFetchedAt(Date.now());
    } catch (err) {
      if (!quiet) setError(err.message || t.watch.failedTitle);
    } finally {
      setRefreshing(false);
    }
  }

  /* Buying a package changes what the account may read, so the figures have
     to be fetched again. Refreshing only the account left newly-unlocked
     screens holding the null they got when the request was refused — which
     is why a purchase used to need a sign-out to take effect. */
  async function refreshEverything() {
    await loadAccount();
    await load();
  }

  async function loadAccount() {
    try {
      const res = await fetch("/api/account", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const json = await res.json();
      setAccount(json);
      const shouldPrompt = json.account && !json.account.posConnected && !json.serverToken;
      if (shouldPrompt && (justRegistered || !skipped)) setConnectOpen(true);
    } catch {
      /* No account endpoint reachable — the app still runs on sample data. */
    }
  }

  /* Pull the account's threads once on entry and fold them in beside
     whatever this device already had. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const remote = await fetchRemote(token);
      if (cancelled || !remote) return;
      const merged = merge(listConversations(user), remote);
      merged.forEach((c) => saveConversation(user, { id: c.id, messages: c.messages }));
      setConversations(listConversations(user));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Show the packages once, to an account that has just registered and
     bought nothing. Not on every account reload — the free tier means most
     accounts legitimately own nothing, and yanking them to a sales screen
     every time the account refreshed made the app unusable. */
  const introShown = useRef(false);
  useEffect(() => {
    if (introShown.current || !account) return;
    if (justRegistered && entitlements(account).registered && !entitlements(account).any) {
      introShown.current = true;
      setTab("billing");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, justRegistered]);

  /* Keep the figures moving.

     Polls while the tab is visible and stops when it isn't — a dashboard
     left open on a back tab shouldn't keep hitting the POS all night. The
     server caches for 45 seconds per account, so several devices in one
     restaurant share a single upstream call rather than multiplying it. */
  useEffect(() => {
    let timer = 0;

    const tick = () => {
      if (document.visibilityState === "visible") load({ quiet: true });
      timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);

    const onVisible = () => {
      // Coming back to the tab should show current figures immediately.
      if (document.visibilityState === "visible") load({ quiet: true });
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
    loadAccount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Keyboard: ⌘K for the palette, 1–5 to jump straight to a screen,
     arrows to move one at a time. Ignored while typing. */
  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA)$/.test(e.target?.tagName) || e.target?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= TAB_META.length) {
        e.preventDefault();
        go(TAB_META[n - 1].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, tab]);

  /* Swipe left and right between screens on touch devices. */
  /* Swiping "forward" means dragging against the reading direction:
     left in English, right in Arabic. */
  useSwipe(mainRef, {
    enabled: !desktop,
    onNext: () => step(rtl ? -1 : 1),
    onPrev: () => step(rtl ? 1 : -1),
  });

  /* A registered account with no POS of its own gets an empty table rather
     than sample figures dressed up as theirs. Deployments running on a
     server-wide token, and the shared-password demo, are unaffected. */
  const unconnectedAccount =
    needsPos || (Boolean(account?.account) && !account.account.posConnected && !account.serverToken);

  const noticedLine = (() => {
    const o = data?.observations?.[0];
    if (!o) return "";
    const v = { ...o.values };
    if (o.id === "trend") v.dir = t.insights[o.tone === "good" ? "up" : "down"];
    if (o.id === "weekend") v.dir = t.insights[v.up ? "above" : "below"];
    return fill(t.insights[o.id], v);
  })();

  const ent = entitlements(account);
  const needed = SCREEN_FEATURE[tab];
  const locked = !ent.has(needed);

  /* Order matters here. Screens that don't depend on the dashboard figures
     are routed first, so a failed or refused metrics load can't hijack them.
     Settings in particular must always open — it's where someone goes to
     connect a POS or buy a package, which is usually the fix for whatever
     made the figures fail in the first place. */
  let body;
  if (tab === "billing") {
    body = <Plans token={token} account={account} onChanged={refreshEverything} />;
  } else if (tab === "settings") {
    body = (
      <Settings
        data={data || EMPTY_METRICS}
        user={user}
        onRefresh={() => load({ fresh: true })}
        refreshing={refreshing}
        token={token}
        conversationCount={conversations.length}
        account={account}
        onConnect={() => setConnectOpen(true)}
        onAccountChange={refreshEverything}
        onSeePlans={() => go("billing")}
        onSession={onSession}
      />
    );
  } else if (locked) {
    body = <Locked feature={needed} onSeePlans={() => go("billing")} />;
  } else if (tab === "ask") {
    body = (
      <Ask
        token={token}
        wide={desktop && !chatsOpen}
        pending={pending}
        onPendingUsed={() => setPending("")}
        messages={messages}
        onMessagesChange={updateMessages}
        data={unconnectedAccount ? null : data}
        noticedLine={unconnectedAccount ? "" : noticedLine}
      />
    );
  } else if (unconnectedAccount) {
    body = <EmptyTable onConnect={() => setConnectOpen(true)} />;
  } else if (!data && error) {
    body = (
      <div className="h-full flex items-center justify-center p-8">
        <div className="max-w-sm text-center">
          <p className="display font-bold text-lg mb-2">{t.watch.failedTitle}</p>
          <p className="text-sm mb-5" style={{ color: C.slate }}>{error}</p>
          <div className="flex flex-wrap gap-2 justify-center">
            <button
              onClick={load}
              className="px-4 py-2 rounded-lg text-sm font-semibold"
              style={{ background: C.iris, color: C.onPrimary }}
            >
              {t.common.tryAgain}
            </button>
            {/* Retrying forever is not the only option. */}
            <button
              onClick={() => go("settings")}
              className="px-4 py-2 rounded-lg text-sm font-semibold"
              style={{ border: `1px solid ${C.hairline}`, color: C.slate }}
            >
              {t.settings.title}
            </button>
          </div>
        </div>
      </div>
    );
  } else if (!data) {
    body = <Skeleton />;
  } else if (tab === "overview") {
    body = (
      <Overview
        data={data}
        onAsk={(q) => {
          startNewChat();
          setPending(q);
        }}
        onOpenCosts={() => go("menu")}
        onGo={go}
      />
    );
  } else if (tab === "watch") {
    body = <Watch data={data} />;
  } else if (tab === "menu") {
    body = <Menu data={data} token={token} onSaved={() => load({ fresh: true })} />;
  } else if (tab === "forecast") {
    body = <Forecast data={data} />;
  } else if (tab === "advice") {
    body = (
      <Advice
        data={data}
        onAsk={(q) => {
          startNewChat();
          setPending(q);
        }}
      />
    );
  }

  const content = (
    <Transition screenKey={tab} direction={direction}>
      <ErrorBoundary key={tab}>{body}</ErrorBoundary>
    </Transition>
  );

  const connectEl = (
    <ConnectDialog
      open={connectOpen}
      token={token}
      onClose={() => {
        setConnectOpen(false);
        setSkipped(true);
        try {
          localStorage.setItem(`sufra_pos_skipped_${user}`, "1");
        } catch {
          /* not fatal */
        }
      }}
      onConnected={() => {
        setConnectOpen(false);
        refreshEverything();
      }}
    />
  );

  const paletteEl = (
    <CommandPalette
      open={palette}
      onClose={() => setPalette(false)}
      onGo={go}
      onAsk={(q) => {
        setPending(q);
        go("ask");
      }}
    />
  );

  const liveDot = data && !unconnectedAccount && (
    <LiveDot fetchedAt={fetchedAt} refreshing={refreshing} />
  );

  const statusPill = data && (
    <span
      className="text-xs px-2 py-1 rounded inline-flex items-center gap-1.5"
      style={{ background: data.connected ? C.irisWash : C.lilacWash, color: C.slate }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: data.connected ? C.iris : C.lilac }} />
      {data.connected ? t.common.live : t.common.demo}
    </span>
  );

  /* Short tab labels for the bottom bar. Some translations are long enough
     to wrap a 60px target, so they're trimmed to the first word — which is
     the distinguishing one in all four languages. */
  const labelFor = (id) => {
    const full = t[id]?.tab || id;
    return full.length > 12 ? full.split(/\s+/)[0] : full;
  };

  const logo = (
    <div className="flex items-center gap-2">
      <NeonMark size={34} glow={0.9} />
      <span className="display font-extrabold text-lg">{t.name}</span>
    </div>
  );

  /* ---------------- Desktop ---------------- */
  if (desktop) {
    // row-reverse under RTL keeps the rail on the physical right in every
    // language. Flex `order` alone follows text direction and would flip it.
    return (
      <div
        className="h-screen flex substrate"
        style={{ flexDirection: rtl ? "row-reverse" : "row" }}
      >
        <main className="flex-1 min-w-0 overflow-hidden">{content}</main>

        {/* Conversation history, alongside the chat only. Collapsible, because
            on a laptop the extra column costs reading width on other screens. */}
        {tab === "ask" && chatsOpen && (
          <div
            className="w-64 shrink-0 overflow-hidden"
            style={{ borderLeft: `1px solid ${C.hairline}` }}
          >
            <ChatSidebar
              conversations={conversations}
              activeId={activeId}
              onSelect={openConversation}
              onNew={startNewChat}
              onDelete={removeConversation}
              online={Boolean(data)}
            />
          </div>
        )}

        <aside
          className="w-60 shrink-0 flex flex-col p-5 rail-in"
          style={{ background: C.surface, borderLeft: `1px solid ${C.hairline}`, boxShadow: `inset 1px 0 0 ${C.edge}` }}
        >
          <div className="mb-6 px-1">{logo}</div>
          <div className="mb-6 px-1">
            <Greeting user={user} business={account?.account?.business} />
          </div>

          <nav className="flex flex-col gap-1 relative">
            {TAB_META.map(({ id, icon: Icon }, i) => {
              const on = tab === id;
              return (
                <button
                  key={id}
                  onClick={() => go(id)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors relative"
                  style={{
                    background: on ? C.irisWash : "transparent",
                    color: on ? C.irisDeep : C.slate,
                    boxShadow: on ? `inset 0 0 0 1px ${C.edge}` : "none",
                  }}
                >
                  <Icon size={17} />
                  <span className="flex-1 text-start">{t[id].tab}</span>
                  {!entitlements(account).has(SCREEN_FEATURE[id]) && (
                    <Lock size={12} style={{ color: C.slate }} />
                  )}
                  <kbd
                    className="data text-[10px] px-1 rounded opacity-0 group-hover:opacity-100"
                    style={{ color: C.slate, opacity: on ? 0.6 : 0.3 }}
                    dir="ltr"
                  >
                    {i + 1}
                  </kbd>
                </button>
              );
            })}
          </nav>

          <div className="mt-auto px-1 space-y-3">
            {tab === "ask" && (
              <button
                onClick={() => setChatsOpen((v) => !v)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold"
                style={{ border: `1px solid ${C.hairline}`, color: C.slate }}
              >
                {chatsOpen ? <PanelRightClose size={13} /> : <PanelRightOpen size={13} />}
                <span className="flex-1 text-start">{t.chats.title}</span>
                <span className="data text-[10px]" dir="ltr">{conversations.length}</span>
              </button>
            )}
            <button
              onClick={() => setPalette(true)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
              style={{ border: `1px solid ${C.hairline}`, color: C.slate }}
            >
              <Search size={13} />
              <span className="flex-1 text-start">{t.palette.open}</span>
              <kbd className="data text-[10px] px-1.5 py-0.5 rounded" style={{ background: C.bone }} dir="ltr">⌘K</kbd>
            </button>
            <LanguagePicker />
            <ThemeToggle />
            {data && statusPill}
            {liveDot}
            <div
              className="flex items-center justify-between gap-2 pt-3"
              style={{ borderTop: `1px solid ${C.hairline}` }}
            >
              <span className="text-xs truncate" style={{ color: C.slate }}>
                {t.settings.signedInAs} <span className="font-medium">{user || "—"}</span>
              </span>
              <button
                onClick={onLogout}
                className="shrink-0 p-1.5 rounded-lg"
                style={{ color: C.rose }}
                aria-label={t.common.signOut}
                title={t.common.signOut}
              >
                <LogOut size={15} className="flip-rtl" />
              </button>
            </div>
          </div>
        </aside>
        {paletteEl}
        {connectEl}
      </div>
    );
  }

  /* ---------------- Mobile and iPad ---------------- */
  /* The overflow sheet, shared by the header button and the bottom bar. */
  const mobileSheet = mobileMenu && (
    <div
      className="absolute inset-0 z-40"
      style={{ background: C.scrim }}
      onClick={() => setMobileMenu(false)}
    >
      <div
        className="absolute bottom-[58px] inset-x-0 p-4 space-y-4 palette-in"
        style={{
          background: C.surface,
          borderTop: `1px solid ${C.edge}`,
          paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <Greeting user={user} business={account?.account?.business} />

        <div className="grid grid-cols-3 gap-2">
          {SECONDARY.map((id) => {
            const Icon = TAB_ICONS[id];
            const on = tab === id;
            const locked = !entitlements(account).has(SCREEN_FEATURE[id]);
            return (
              <button
                key={id}
                onClick={() => go(id)}
                className="panel p-3 flex flex-col items-center gap-1.5"
                style={{ color: on ? C.neon : C.ink }}
              >
                <Icon size={19} />
                <span className="text-xs font-medium truncate-safe max-w-full">{t[id].tab}</span>
                {locked && <Lock size={10} style={{ color: C.slate }} />}
              </button>
            );
          })}
        </div>

        {data && <div>{statusPill}</div>}

        <div className="flex items-center justify-between gap-3">
          <span className="micro" style={{ color: C.slate }}>{t.settings.language}</span>
          <LanguagePicker />
        </div>
        <div>
          <div className="micro mb-2" style={{ color: C.slate }}>{t.theme.label}</div>
          <ThemeToggle />
        </div>

        <button
          onClick={onLogout}
          className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold"
          style={{ border: `1px solid ${C.hairline}`, color: C.rose }}
        >
          <LogOut size={15} className="flip-rtl" /> {t.common.signOut}
        </button>
      </div>
    </div>
  );

  return (
    <MobileShell
      tab={tab}
      go={go}
      tabIcons={TAB_ICONS}
      labelFor={labelFor}
      liveDot={liveDot}
      onOpenChats={() => setChatsOpen(true)}
      onOpenMenu={() => setMobileMenu((v) => !v)}
      menuOpen={mobileMenu}
      sheet={mobileSheet}
    >
      {content}

      {!desktop && chatsOpen && tab === "ask" && (
        <div
          className="fixed inset-0 z-50 flex"
          style={{ background: C.scrim, flexDirection: rtl ? "row-reverse" : "row" }}
          onClick={() => setChatsOpen(false)}
        >
          <div className="flex-1" />
          <div
            className="w-72 max-w-[82vw] palette-in"
            style={{ borderLeft: `1px solid ${C.hairline}` }}
            onClick={(e) => e.stopPropagation()}
          >
            <ChatSidebar
              conversations={conversations}
              activeId={activeId}
              onSelect={(id) => { openConversation(id); setChatsOpen(false); }}
              onNew={() => { startNewChat(); setChatsOpen(false); }}
              onDelete={removeConversation}
              online={Boolean(data)}
            />
          </div>
        </div>
      )}

      {paletteEl}
      {connectEl}
    </MobileShell>
  );
}
