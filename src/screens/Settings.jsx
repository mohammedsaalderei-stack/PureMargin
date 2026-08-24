import { useState } from "react";
import { CheckCircle2, AlertCircle, RefreshCw, Plug, Loader2 as Spin, Loader2, Send, LifeBuoy, Instagram, Mail, Phone } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill, localeFor, formatDate } from "../i18n.jsx";
import { contactRows } from "../contact.js";
import { BUILD } from "../build.js";
import { KeyRound, LogOut as SignOutIcon } from "lucide-react";
import LanguagePicker from "../LanguagePicker.jsx";
import ThemeToggle from "../ThemeToggle.jsx";
import DeleteConfirm from "../DeleteConfirm.jsx";
import EmailSetting from "../settings/EmailSetting.jsx";

function Panel({ title, children }) {
  const C = useC();
  return (
    <div className="panel p-5 md:p-6" style={{ background: C.surface, border: `1px solid ${C.hairline}` }}>
      <h3 className="display font-bold text-base mb-4">{title}</h3>
      {children}
    </div>
  );
}

function Row({ label, value }) {
  const C = useC();
  return (
    <div className="flex items-center justify-between py-2.5 text-sm gap-4" style={{ borderBottom: `1px solid ${C.hairline}` }}>
      <span style={{ color: C.slate }}>{label}</span>
      <span className="font-medium text-end">{value}</span>
    </div>
  );
}

/* Edit these once and they update everywhere they appear. */
const ALERT_KEYS = [
  "alertEod", "alertSwing", "alertMargin", "alertOrder",
  "alertTarget", "alertFirst", "alertPeak", "alertWeekly", "alertGoal",
];

const DEFAULT_ALERTS = {
  alertEod: true, alertSwing: true, alertMargin: true, alertOrder: false,
  alertTarget: true, alertFirst: true, alertPeak: true, alertWeekly: true, alertGoal: false,
};

function readAlerts() {
  try {
    return { ...DEFAULT_ALERTS, ...JSON.parse(localStorage.getItem("sufra_alerts") || "{}") };
  } catch {
    return DEFAULT_ALERTS;
  }
}

export default function Settings({ data, user, onRefresh, refreshing, token, conversationCount = 0, account, onConnect, onAccountChange, onSeePlans, onSession, onLogout }) {
  const C = useC();
  const { t, lang } = useLang();
  const live = data.connected;

  const [alerts, setAlerts] = useState(readAlerts);
  const [target, setTarget] = useState("");
  const [eodTime, setEodTime] = useState("20:00");
  const [savedAlerts, setSavedAlerts] = useState(false);

  const [ticket, setTicket] = useState({ subject: "", category: "catTechnical", priority: "prioNormal", detail: "" });
  const [sending, setSending] = useState(false);
  const [ticketNote, setTicketNote] = useState("");

  const saveAlerts = () => {
    try {
      localStorage.setItem("sufra_alerts", JSON.stringify(alerts));
      localStorage.setItem("sufra_target", target);
      localStorage.setItem("sufra_eod", eodTime);
    } catch {
      /* storage unavailable */
    }
    setSavedAlerts(true);
    setTimeout(() => setSavedAlerts(false), 2200);
  };

  /* Tickets reuse the feedback pipeline — same destination, same webhook,
     one thing to configure rather than two. */
  const sendTicket = async () => {
    if (!ticket.subject.trim()) {
      setTicketNote(t.support.needSubject);
      return;
    }
    setSending(true);
    setTicketNote("");
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          question: `[TICKET ${t.support[ticket.category]} / ${t.support[ticket.priority]}] ${ticket.subject}`,
          answer: ticket.detail,
          reason: "other",
          detail: ticket.subject,
          lang,
        }),
      });
      setTicket({ subject: "", category: "catTechnical", priority: "prioNormal", detail: "" });
      setTicketNote(t.support.sent);
    } catch {
      setTicketNote(t.feedback.failed);
    } finally {
      setSending(false);
    }
  };

  const [posValue, setPosValue] = useState("");
  const [posBusy, setPosBusy] = useState(false);
  const [posNote, setPosNote] = useState("");
  const posConnected = Boolean(account?.account?.posConnected);
  const serverToken = Boolean(account?.serverToken);

  const savePos = async (value) => {
    setPosBusy(true);
    setPosNote("");
    try {
      const res = await fetch("/api/account", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ posToken: value }),
      });
      if (!res.ok) throw new Error();
      setPosValue("");
      setPosNote(value ? t.connect.connected : "");
      onAccountChange?.();
      onRefresh?.();
    } catch {
      setPosNote(t.connect.failed);
    } finally {
      setPosBusy(false);
    }
  };

  /* Account deletion is a request with a grace period, so the panel has
     three states: nothing pending, confirming, and scheduled. */
  /* Password and session safety. */
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwNote, setPwNote] = useState("");
  const [pwError, setPwError] = useState(false);

  const PW_ERRORS = { wrongcurrent: "wrongCurrent", short: "tooShort", weak: "tooWeak" };

  const submitPassword = async () => {
    if (pw.next !== pw.confirm) {
      setPwError(true);
      setPwNote(t.security.mismatch);
      return;
    }
    setPwBusy(true);
    setPwNote("");
    try {
      const res = await fetch("/api/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ current: pw.current, next: pw.next }),
      });
      const json = await res.json();
      if (!res.ok) {
        setPwError(true);
        setPwNote(t.security[PW_ERRORS[json.error]] || t.register.errServer);
        return;
      }
      /* The new token replaces this session's, so changing your password
         doesn't sign you out of the device you changed it on. */
      onSession?.(json.token);
      setPw({ current: "", next: "", confirm: "" });
      setPwError(false);
      setPwNote(t.security.changed);
      onAccountChange?.();
    } catch {
      setPwError(true);
      setPwNote(t.register.errServer);
    } finally {
      setPwBusy(false);
    }
  };

  const signOutEverywhere = async () => {
    setPwBusy(true);
    try {
      const res = await fetch("/api/password", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (res.ok) {
        onSession?.(json.token);
        setPwError(false);
        setPwNote(t.security.signedOutAll);
        onAccountChange?.();
      }
    } finally {
      setPwBusy(false);
    }
  };

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmNow, setConfirmNow] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const pendingDelete = account?.account?.deleteAfter || null;

  const changeDeletion = async (method) => {
    setDeleteBusy(true);
    try {
      await fetch("/api/account", { method, headers: { Authorization: `Bearer ${token}` } });
      setConfirmDelete(false);
      onAccountChange?.();
    } finally {
      setDeleteBusy(false);
    }
  };

  /* Immediate deletion. The account is gone when this returns, so there is
     nothing left to refresh — sign out rather than leave the session holding a
     token whose account no longer exists. */
  const deleteImmediately = async () => {
    setDeleteBusy(true);
    try {
      await fetch("/api/account?now=1", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      onLogout?.();
    } finally {
      setDeleteBusy(false);
    }
  };

  const plan = account?.account?.plan;
  const planItems = plan?.items || [];
  const subDays = plan?.until ? Math.max(0, Math.ceil((plan.until - Date.now()) / 864e5)) : 0;
  const termDays =
    plan?.since && plan?.until ? Math.max(1, Math.ceil((plan.until - plan.since) / 864e5)) : 0;
  const subPct = termDays ? Math.round((subDays / termDays) * 1000) / 10 : 0;
  const fmt = (ts) =>
    ts ? formatDate(ts, lang) : "—";

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-5 md:py-8 space-y-4 md:space-y-5">
        <h2 className="display text-2xl md:text-3xl font-extrabold">{t.settings.title}</h2>

        {account?.account && (
          <Panel title={t.connect.posTitle}>
            <div
              className="flex items-start gap-3 p-4 rounded-lg mb-4"
              style={{ background: posConnected ? C.irisWash : C.lilacWash }}
            >
              <Plug size={18} className="mt-0.5 shrink-0" style={{ color: posConnected ? C.iris : C.lilac }} />
              <div>
                <div className="font-semibold text-sm mb-1">
                  {posConnected ? t.connect.posConnected : t.connect.posNot}
                </div>
                <p className="text-sm leading-relaxed" style={{ color: C.slate }}>
                  {serverToken && !posConnected ? t.connect.usingServer : t.connect.lead}
                </p>
              </div>
            </div>

            <div className="text-xs px-3 py-2 rounded-lg mb-3" style={{ background: C.bone, color: C.slate }} dir="ltr">
              {t.connect.where}
            </div>

            <label className="block text-sm font-semibold mb-1.5">{t.connect.token}</label>
            <input
              value={posValue}
              onChange={(e) => setPosValue(e.target.value)}
              placeholder={t.connect.placeholder}
              dir="ltr"
              className="w-full rounded-lg px-4 py-2.5 text-sm outline-none text-start mb-3"
              style={{ background: C.bone, border: `1px solid ${C.hairline}`, color: C.ink }}
            />

            {posNote && (
              <p className="text-sm mb-3" style={{ color: posNote === t.connect.failed ? C.rose : C.iris }}>
                {posNote}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => savePos(posValue.trim())}
                disabled={posBusy || !posValue.trim()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
                style={{ background: C.iris, color: C.onPrimary }}
              >
                {posBusy && <Spin size={14} className="animate-spin" />}
                {posConnected ? t.connect.posReplace : t.connect.save}
              </button>
              {posConnected && (
                <button
                  onClick={() => savePos("")}
                  disabled={posBusy}
                  className="px-4 py-2 rounded-lg text-sm font-semibold"
                  style={{ border: `1px solid ${C.hairline}`, color: C.rose }}
                >
                  {t.connect.posRemove}
                </button>
              )}
            </div>

            <p className="text-[11px] mt-3 leading-relaxed" style={{ color: C.slate }}>
              {t.connect.posNote}
            </p>
          </Panel>
        )}

        <Panel title={t.settings.dataSource}>
          <div className="flex items-start gap-3 p-4 rounded-lg mb-4" style={{ background: live ? C.irisWash : C.lilacWash }}>
            {live
              ? <CheckCircle2 size={19} style={{ color: C.iris }} className="mt-0.5 shrink-0" />
              : <AlertCircle size={19} style={{ color: C.irisDeep }} className="mt-0.5 shrink-0" />}
            <div>
              <div className="font-semibold text-sm mb-1">
                {live ? t.settings.connected : t.settings.notConnected}
              </div>
              <p className="text-sm leading-relaxed" style={{ color: C.slate }}>
                {live ? t.settings.connectedBody : t.settings.notConnectedBody}
              </p>
            </div>
          </div>

          <Row label={t.settings.source} value={data.source} />
          <Row
            label={t.settings.updated}
            value={data.updatedAt ? new Date(data.updatedAt).toLocaleString(localeFor(lang)) : "—"}
          />
          <Row label={t.settings.currency} value={data.currency} />
          <Row label={t.settings.branchCount} value={String(data.stores.length)} />

          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
            style={{ border: `1px solid ${C.hairline}` }}
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? t.common.refreshing : t.common.refresh}
          </button>
        </Panel>

        <Panel title={t.settings.branchCount}>
          {data.stores.map((s) => (
            <Row key={s.id} label={s.name} value={`${s.receipts.toLocaleString("en-AE")} ${t.common.orders}`} />
          ))}
        </Panel>

        <Panel title={t.billing.current}>
          {planItems.length === 0 ? (
            <>
              <p className="text-sm mb-4" style={{ color: C.slate }}>{t.billing.none}</p>
              <button
                onClick={onSeePlans}
                className="px-4 py-2 rounded-lg text-sm font-semibold"
                style={{ background: C.iris, color: C.onPrimary }}
              >
                {t.billing.add}
              </button>
            </>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 mb-4">
                {planItems.map((id) => (
                  <span
                    key={id}
                    className="text-xs font-semibold px-3 py-1.5 rounded-full"
                    style={{ background: C.irisWash, color: C.irisDeep }}
                  >
                    {t.billing.features[id]}
                  </span>
                ))}
              </div>

              <div className="rounded-xl p-5 mb-4" style={{ background: C.irisWash }}>
                <div className="display text-2xl font-extrabold mb-1" style={{ color: C.irisDeep }}>
                  <span dir="ltr">{subDays}</span> {t.account.daysLeft}
                </div>
                <div className="h-1.5 rounded-full my-3" style={{ background: C.surface }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.min(100, subPct)}%`, background: C.iris }}
                  />
                </div>
                <div className="text-xs" style={{ color: C.slate }}>
                  {fill(t.account.remaining, { pct: subPct })}
                </div>
              </div>

              <Row label={t.account.start} value={fmt(plan?.since)} />
              <Row label={t.account.end} value={fmt(plan?.until)} />

              <button
                onClick={onSeePlans}
                className="mt-4 px-4 py-2 rounded-lg text-sm font-semibold"
                style={{ border: `1px solid ${C.hairline}` }}
              >
                {t.billing.manage}
              </button>
            </>
          )}
        </Panel>

        <Panel title={t.account.usage}>
          <div className="grid grid-cols-3 gap-3 mb-2">
            {[
              [t.account.conversations, conversationCount, t.account.unarchived],
              [t.account.totalQuestions, account?.account?.questionCount ?? 0, t.account.sinceStart],
              [t.account.last30, account?.account?.questionCount ?? 0, t.account.recent],
            ].map(([label, value, note]) => (
              <div key={label} className="rounded-xl p-4" style={{ background: C.bone }}>
                <div className="display text-2xl font-extrabold leading-none mb-1.5" dir="ltr">{value}</div>
                <div className="text-xs font-semibold">{label}</div>
                <div className="text-[11px] mt-0.5" style={{ color: C.slate }}>{note}</div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title={t.account.alerts}>
          <p className="text-xs mb-4" style={{ color: C.slate }}>{t.account.alertsLead}</p>
          {ALERT_KEYS.map((k) => (
            <label
              key={k}
              className="flex items-center gap-3 py-2.5 cursor-pointer"
              style={{ borderBottom: `1px solid ${C.hairline}` }}
            >
              <input
                type="checkbox"
                checked={alerts[k]}
                onChange={(e) => setAlerts({ ...alerts, [k]: e.target.checked })}
                className="w-4 h-4 shrink-0"
                style={{ accentColor: C.iris }}
              />
              <span className="text-sm flex-1">{t.account[k]}</span>
            </label>
          ))}

          <div className="grid sm:grid-cols-2 gap-3 mt-4">
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: C.slate }}>
                {t.account.dailyTarget}
              </label>
              <input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                inputMode="numeric"
                dir="ltr"
                className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{ background: C.bone, border: `1px solid ${C.hairline}` }}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: C.slate }}>
                {t.account.eodTime}
              </label>
              <input
                type="time"
                value={eodTime}
                onChange={(e) => setEodTime(e.target.value)}
                dir="ltr"
                className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={{ background: C.bone, border: `1px solid ${C.hairline}` }}
              />
            </div>
          </div>

          <button
            onClick={saveAlerts}
            className="mt-4 px-4 py-2 rounded-lg text-sm font-semibold"
            style={{ background: C.iris, color: C.onPrimary }}
          >
            {savedAlerts ? t.account.saved : t.account.saveAlerts}
          </button>
        </Panel>

        <Panel title={t.support.title}>
          <p className="text-xs mb-4" style={{ color: C.slate }}>{t.support.lead}</p>

          <div className="flex flex-wrap gap-2 mb-5">
            {contactRows().map((row) => {
              const Icon = { phone: Phone, email: Mail, instagram: Instagram }[row.kind];
              return (
                <a
                  key={row.kind}
                  href={row.href}
                  target={row.kind === "instagram" ? "_blank" : undefined}
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full hover:opacity-80"
                  style={{ border: `1px solid ${C.hairline}`, color: C.slate }}
                >
                  <Icon size={12} />
                  <span dir="ltr">{row.label}</span>
                </a>
              );
            })}
          </div>

          <div className="flex items-center gap-2 mb-3">
            <LifeBuoy size={14} style={{ color: C.iris }} />
            <span className="font-semibold text-sm">{t.support.ticket}</span>
          </div>

          <input
            value={ticket.subject}
            onChange={(e) => setTicket({ ...ticket, subject: e.target.value })}
            placeholder={t.support.subject}
            className="w-full rounded-lg px-3 py-2.5 text-sm outline-none mb-3"
            style={{ background: C.bone, border: `1px solid ${C.hairline}` }}
          />

          <div className="grid grid-cols-2 gap-3 mb-3">
            <select
              value={ticket.category}
              onChange={(e) => setTicket({ ...ticket, category: e.target.value })}
              className="rounded-lg px-3 py-2.5 text-sm outline-none"
              style={{ background: C.bone, border: `1px solid ${C.hairline}`, color: C.ink }}
            >
              {["catTechnical", "catData", "catBilling", "catOther"].map((k) => (
                <option key={k} value={k}>{t.support[k]}</option>
              ))}
            </select>
            <select
              value={ticket.priority}
              onChange={(e) => setTicket({ ...ticket, priority: e.target.value })}
              className="rounded-lg px-3 py-2.5 text-sm outline-none"
              style={{ background: C.bone, border: `1px solid ${C.hairline}`, color: C.ink }}
            >
              {["prioNormal", "prioHigh", "prioUrgent"].map((k) => (
                <option key={k} value={k}>{t.support[k]}</option>
              ))}
            </select>
          </div>

          <textarea
            value={ticket.detail}
            onChange={(e) => setTicket({ ...ticket, detail: e.target.value })}
            rows={3}
            placeholder={t.support.describe}
            className="w-full rounded-lg px-3 py-2.5 text-sm outline-none resize-none mb-3"
            style={{ background: C.bone, border: `1px solid ${C.hairline}` }}
          />

          {ticketNote && (
            <p className="text-sm mb-3" style={{ color: ticketNote === t.support.sent ? C.iris : C.rose }}>
              {ticketNote}
            </p>
          )}

          <button
            onClick={sendTicket}
            disabled={sending}
            className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-60"
            style={{ background: C.iris, color: C.onPrimary }}
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {sending ? t.feedback.sending : t.support.send}
          </button>
        </Panel>

        <Panel title={t.settings.account}>
          <Row label={t.settings.signedInAs} value={account?.account?.username || user || "—"} />
          <Row label={t.settings.business} value={account?.account?.business || "—"} />
          <Row label={t.account.created} value={fmt(account?.account?.createdAt)} />
          <Row label={t.account.firstQuestion} value={fmt(account?.account?.firstQuestionAt)} />
          <Row label={t.account.lastQuestion} value={fmt(account?.account?.lastQuestionAt)} />
          <div className="flex items-center justify-between py-2.5 text-sm">
            <span style={{ color: C.slate }}>{t.settings.language}</span>
<LanguagePicker />
          </div>

          {/* The address lives with the account details it belongs to, rather
              than in the password panel — it is an identity, not a secret. */}
          <EmailSetting
            token={token}
            account={account?.account}
            onAccountChange={onAccountChange}
          />
        </Panel>

        <Panel title={t.security.title}>
          <p className="text-xs mb-4" style={{ color: C.slate }}>{t.security.lead}</p>

          <Row label={t.security.lastSignIn} value={fmt(account?.account?.lastLoginAt) || t.security.never} />
          <Row
            label={t.security.passwordChanged}
            value={account?.account?.passwordChangedAt ? fmt(account.account.passwordChangedAt) : t.security.never}
          />

          <div className="mt-5 space-y-3">
            {[
              ["current", t.security.current, "current-password"],
              ["next", t.security.next, "new-password"],
              ["confirm", t.security.confirm, "new-password"],
            ].map(([key, label, complete]) => (
              <div key={key}>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: C.slate }}>
                  {label}
                </label>
                <input
                  type="password"
                  autoComplete={complete}
                  value={pw[key]}
                  onChange={(e) => setPw({ ...pw, [key]: e.target.value })}
                  dir="ltr"
                  className="w-full rounded-lg px-3 py-2.5 text-sm outline-none text-start"
                  style={{ background: C.bone, border: `1px solid ${C.hairline}`, color: C.ink }}
                />
              </div>
            ))}
          </div>

          {pwNote && (
            <p className="text-sm mt-3" style={{ color: pwError ? C.rose : C.iris }}>{pwNote}</p>
          )}

          <button
            onClick={submitPassword}
            disabled={pwBusy || !pw.current || !pw.next}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
            style={{ background: C.iris, color: C.onPrimary }}
          >
            {pwBusy ? <Spin size={14} className="animate-spin" /> : <KeyRound size={14} />}
            {pwBusy ? t.security.changing : t.security.change}
          </button>

          <div className="mt-6 pt-5" style={{ borderTop: `1px solid ${C.hairline}` }}>
            <p className="text-xs mb-3" style={{ color: C.slate }}>{t.security.signOutAllNote}</p>
            <button
              onClick={signOutEverywhere}
              disabled={pwBusy}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold"
              style={{ border: `1px solid ${C.hairline}`, color: C.slate }}
            >
              <SignOutIcon size={14} className="flip-rtl" />
              {t.security.signOutAll}
            </button>
          </div>
        </Panel>

        <div className="text-center text-[11px] pt-2" style={{ color: C.slate }}>
          <span className="data" dir="ltr">build {BUILD}</span>
        </div>

        <div className="panel p-5 md:p-6" style={{ border: `1px solid ${C.rose}` }}>
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle size={16} style={{ color: C.rose }} />
            <h3 className="display font-bold text-base" style={{ color: C.rose }}>{t.account.danger}</h3>
          </div>
          {pendingDelete ? (
            <>
              <p className="text-sm leading-relaxed mb-4" style={{ color: C.rose }}>
                {fill(t.account.deletePending, { date: fmt(pendingDelete) })}
              </p>
              <button
                onClick={() => changeDeletion("POST")}
                disabled={deleteBusy}
                className="px-4 py-2 rounded-lg text-sm font-semibold"
                style={{ background: C.iris, color: C.onPrimary }}
              >
                {t.account.keepAccount}
              </button>
            </>
          ) : confirmDelete ? (
            <DeleteConfirm
              busy={deleteBusy}
              onConfirm={() => changeDeletion("DELETE")}
              onCancel={() => setConfirmDelete(false)}
            />
          ) : confirmNow ? (
            <DeleteConfirm
              tone="now"
              busy={deleteBusy}
              onConfirm={deleteImmediately}
              onCancel={() => setConfirmNow(false)}
            />
          ) : (
            <>
              <p className="text-sm leading-relaxed mb-4" style={{ color: C.slate }}>{t.account.dangerLead}</p>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="px-4 py-2 rounded-lg text-sm font-semibold"
                  style={{ background: C.rose, color: "#fff" }}
                >
                  {t.account.requestDelete}
                </button>
                {/* The grace period stays the default; someone who wants their
                    data gone now shouldn't have to wait a week for it. */}
                <button
                  onClick={() => setConfirmNow(true)}
                  className="text-xs font-semibold underline"
                  style={{ color: C.slate }}
                >
                  {t.account.deleteNow}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
