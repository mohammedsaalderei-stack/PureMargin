import { useEffect, useState } from "react";
import {
  ShieldCheck, Loader2, LogOut, RefreshCw, Trash2, Check, X, UserCog, Plug,
} from "lucide-react";
import { useC } from "./theme.jsx";
import BrandMark from "./BrandMark.jsx";
import { useLang, fill, localeFor } from "./i18n.jsx";
import ThemeToggle from "./ThemeToggle.jsx";
import LanguagePicker from "./LanguagePicker.jsx";

/* The admin panel — reached at #admin, and only usable by admin accounts.

   Sign-in here is separate from the app: it always asks for the password
   again and mints its own 30-minute token, so a borrowed laptop with an app
   session open still can't reach this screen. Everything it can do lives in
   /api/admin. */

const FEATURE_LABELS = {
  assistant: "Assistant",
  menu: "Menu engineering",
  forecast: "Forecast",
  operations: "Operations suite",
  billscan: "AI bill scanner",
};

async function call(adminToken, body) {
  const res = await fetch("/api/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}) },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, ...json };
}

function Login({ onAuthed }) {
  const C = useC();
  const { t } = useLang();
  const s = t.admin;
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const out = await call(null, { action: "login", identifier, password });
    setBusy(false);
    if (!out.ok) { setError(s.badLogin); return; }
    onAuthed(out.adminToken, out.username);
  }

  return (
    <div className="min-h-full flex items-center justify-center p-6" style={{ background: C.bone }}>
      <form onSubmit={submit} className="w-full max-w-sm panel p-6 md:p-8">
        <div className="flex items-center gap-2 mb-6">
          <BrandMark size={32} />
          <span className="display font-extrabold text-lg">{t.name}</span>
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full ms-auto"
            style={{ background: C.irisWash, color: C.iris }}>
            <ShieldCheck size={11} className="inline me-1" style={{ verticalAlign: -1 }} />{s.badge}
          </span>
        </div>
        <h1 className="display font-extrabold text-xl mb-1">{s.loginTitle}</h1>
        <p className="text-sm mb-6" style={{ color: C.slate }}>{s.loginLead}</p>

        <label className="block text-sm font-semibold mb-1.5">{s.identifier}</label>
        <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username"
          className="w-full px-3 py-2.5 rounded-lg text-sm mb-4" dir="ltr"
          style={{ border: `1px solid ${C.hairline}`, background: C.surface, color: C.ink }} />
        <label className="block text-sm font-semibold mb-1.5">{s.password}</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
          className="w-full px-3 py-2.5 rounded-lg text-sm mb-5" dir="ltr"
          style={{ border: `1px solid ${C.hairline}`, background: C.surface, color: C.ink }} />

        {error && <p className="text-sm mb-4" style={{ color: C.rose }}>{error}</p>}

        <button type="submit" disabled={busy || !identifier || !password}
          className="w-full rounded-lg py-2.5 text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50"
          style={{ background: C.iris, color: C.onPrimary }}>
          {busy && <Loader2 size={14} className="animate-spin" />} {s.signIn}
        </button>

        <button type="button" onClick={() => { window.location.hash = ""; }}
          className="w-full mt-3 text-xs" style={{ color: C.slate }}>
          {s.backToApp}
        </button>
      </form>
    </div>
  );
}

function GrantForm({ features, months, onGrant, onClose, busy }) {
  const C = useC();
  const { t } = useLang();
  const s = t.admin;
  const [picked, setPicked] = useState([]);
  const [duration, setDuration] = useState(1);

  return (
    <div className="mt-3 p-3 rounded-lg space-y-3" style={{ background: "var(--chip-bg)" }}>
      <div className="flex flex-wrap gap-2">
        {features.map((f) => {
          const on = picked.includes(f);
          return (
            <button key={f} onClick={() => setPicked(on ? picked.filter((x) => x !== f) : [...picked, f])}
              className="px-2.5 py-1 rounded-lg text-xs font-medium"
              style={{ border: `1px solid ${on ? C.iris : C.hairline}`, background: on ? C.irisWash : "transparent", color: on ? C.ink : C.slate }}>
              {FEATURE_LABELS[f] || f}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs" style={{ color: C.slate }}>{s.duration}</span>
        {months.map((m) => (
          <button key={m} onClick={() => setDuration(m)}
            className="px-2.5 py-1 rounded-lg text-xs font-semibold"
            style={duration === m ? { background: C.iris, color: C.onPrimary } : { border: `1px solid ${C.hairline}`, color: C.slate }}>
            {fill(s.monthsLabel, { n: m })}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button onClick={() => onGrant(picked, duration)} disabled={busy || !picked.length}
          className="px-4 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
          style={{ background: C.iris, color: C.onPrimary }}>
          <Check size={12} /> {s.activate}
        </button>
        <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-semibold"
          style={{ border: `1px solid ${C.hairline}`, color: C.slate }}>
          {s.close}
        </button>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const C = useC();
  const { t, lang } = useLang();
  const s = t.admin;
  const [adminToken, setAdminToken] = useState(() => sessionStorage.getItem("sufra_admin") || "");
  const [who, setWho] = useState("");
  const [data, setData] = useState(null);
  const [admins, setAdmins] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [granting, setGranting] = useState("");
  const [confirmDelete, setConfirmDelete] = useState("");
  const [newAdmin, setNewAdmin] = useState("");

  const signOut = () => {
    sessionStorage.removeItem("sufra_admin");
    setAdminToken("");
    setData(null);
  };

  async function load(token = adminToken) {
    const [a, b] = await Promise.all([call(token, { action: "accounts" }), call(token, { action: "admins" })]);
    if (!a.ok) { if (a.status === 401 || a.status === 403) signOut(); return; }
    setData(a);
    if (b.ok) setAdmins(b);
  }

  useEffect(() => { if (adminToken) load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken]);

  async function act(body, refresh = true) {
    setBusy(true);
    setError("");
    const out = await call(adminToken, body);
    setBusy(false);
    if (!out.ok) {
      if (out.status === 401) { signOut(); return null; }
      setError(s.failed);
      return null;
    }
    if (refresh) await load();
    return out;
  }

  if (!adminToken) {
    return <Login onAuthed={(tk, name) => {
      sessionStorage.setItem("sufra_admin", tk);
      setAdminToken(tk);
      setWho(name);
    }} />;
  }

  const fmt = (ms) => (ms ? new Date(ms).toLocaleDateString(localeFor(lang)) : "—");

  return (
    <div className="min-h-full" style={{ background: C.bone }}>
      <header className="sticky top-0 z-40 backdrop-blur px-4 md:px-8"
        style={{ background: `${C.bone}dd`, borderBottom: `1px solid ${C.hairline}` }}>
        <div className="max-w-5xl mx-auto h-14 flex items-center gap-3">
          <BrandMark size={30} />
          <span className="display font-extrabold">{t.name}</span>
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: C.irisWash, color: C.iris }}>{s.badge}</span>
          <span className="text-xs ms-auto hidden sm:inline" style={{ color: C.slate }}>{who}</span>
          <ThemeToggle compact />
          <LanguagePicker compact />
          <button onClick={() => load()} className="p-1.5 rounded-lg" style={{ color: C.slate }} title={s.refresh}>
            <RefreshCw size={15} />
          </button>
          <button onClick={signOut} className="p-1.5 rounded-lg" style={{ color: C.rose }} title={t.common.signOut}>
            <LogOut size={15} className="flip-rtl" />
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 md:px-8 py-6 space-y-5">
        <div>
          <h1 className="display font-extrabold text-2xl">{s.title}</h1>
          <p className="text-sm mt-1" style={{ color: C.slate }}>{s.lead}</p>
        </div>

        {error && <p className="text-sm" style={{ color: C.rose }}>{error}</p>}

        {!data ? (
          <div className="py-16 text-center"><Loader2 size={22} className="animate-spin mx-auto" style={{ color: C.slate }} /></div>
        ) : (
          <>
            <div className="panel p-5">
              <h3 className="display font-bold text-base mb-1">{fill(s.accountsTitle, { n: data.accounts.length })}</h3>
              <p className="text-xs mb-4" style={{ color: C.slate }}>{s.accountsNote}</p>

              <div className="space-y-2">
                {data.accounts.map((a) => (
                  <div key={a.username} className="p-3 rounded-xl" style={{ border: `1px solid ${C.hairline}` }}>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-semibold text-sm">{a.username}</span>
                      <span className="text-xs" style={{ color: C.slate }} dir="ltr">{a.email}</span>
                      {a.business && <span className="text-xs" style={{ color: C.slate }}>{a.business}</span>}
                      {a.isAdmin && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: C.irisWash, color: C.iris }}>
                          {s.adminBadge}
                        </span>
                      )}
                      {a.posConnected && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold" style={{ color: C.iris }}>
                          <Plug size={10} /> {s.posConnected}
                        </span>
                      )}
                      <span className="text-[11px] ms-auto" style={{ color: C.slate }}>
                        {s.joined} {fmt(a.createdAt)} · {s.lastSeen} {fmt(a.lastLoginAt)}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      {a.plan.items.length ? (
                        <>
                          {a.plan.items.map((f) => (
                            <span key={f} className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                              style={{ background: "var(--chip-bg)", color: a.plan.expired ? C.rose : C.ink }}>
                              {FEATURE_LABELS[f] || f}
                            </span>
                          ))}
                          <span className="text-[11px]" style={{ color: a.plan.expired ? C.rose : C.slate }}>
                            {a.plan.expired ? s.expired : fill(s.daysLeft, { n: a.plan.daysLeft ?? "—", date: fmt(a.plan.until) })}
                          </span>
                        </>
                      ) : (
                        <span className="text-[11px]" style={{ color: C.slate }}>{s.noPlan}</span>
                      )}

                      <div className="flex gap-1.5 ms-auto">
                        <button onClick={() => setGranting(granting === a.username ? "" : a.username)}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-semibold"
                          style={{ background: C.iris, color: C.onPrimary }}>
                          {s.grant}
                        </button>
                        {a.plan.items.length > 0 && (
                          <button onClick={() => act({ action: "cancel", username: a.username })} disabled={busy}
                            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold"
                            style={{ border: `1px solid ${C.hairline}`, color: C.slate }}>
                            {s.endPlan}
                          </button>
                        )}
                        {confirmDelete === a.username ? (
                          <>
                            <button onClick={async () => { await act({ action: "remove", username: a.username }); setConfirmDelete(""); }}
                              disabled={busy}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold"
                              style={{ background: C.rose, color: "#fff" }}>
                              {s.confirmDelete}
                            </button>
                            <button onClick={() => setConfirmDelete("")}
                              className="p-1 rounded-lg" style={{ color: C.slate }}><X size={13} /></button>
                          </>
                        ) : (
                          <button onClick={() => setConfirmDelete(a.username)}
                            className="p-1.5 rounded-lg" style={{ color: C.rose }} title={s.deleteAccount}>
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>

                    {granting === a.username && (
                      <GrantForm features={data.features} months={data.months} busy={busy}
                        onGrant={async (items, m) => {
                          const out = await act({ action: "grant", username: a.username, items, months: m });
                          if (out) setGranting("");
                        }}
                        onClose={() => setGranting("")} />
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="panel p-5">
              <h3 className="display font-bold text-base mb-1 flex items-center gap-2">
                <UserCog size={15} style={{ color: C.iris }} /> {s.adminsTitle}
              </h3>
              <p className="text-xs mb-4" style={{ color: C.slate }}>{s.adminsNote}</p>

              <div className="space-y-1.5 mb-4">
                {(admins?.admins || []).map((email) => (
                  <div key={email} className="flex items-center gap-2 py-1.5 px-3 rounded-lg text-sm"
                    style={{ background: "var(--chip-bg)" }}>
                    <span className="flex-1" dir="ltr">{email}</span>
                    {email === admins?.bootstrap ? (
                      <span className="text-[10px] font-bold" style={{ color: C.iris }}>{s.bootstrap}</span>
                    ) : (
                      <button onClick={() => act({ action: "removeAdmin", email }).then((out) => out && setAdmins((x) => ({ ...x, admins: out.admins })))}
                        disabled={busy} className="p-1 rounded" style={{ color: C.rose }}>
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <input value={newAdmin} onChange={(e) => setNewAdmin(e.target.value)} placeholder={s.adminEmailPlaceholder}
                  dir="ltr" className="flex-1 px-3 py-2 rounded-lg text-sm"
                  style={{ border: `1px solid ${C.hairline}`, background: "transparent", color: C.ink }} />
                <button
                  onClick={async () => {
                    const out = await act({ action: "addAdmin", email: newAdmin });
                    if (out) { setAdmins((x) => ({ ...x, admins: out.admins })); setNewAdmin(""); }
                  }}
                  disabled={busy || !newAdmin.includes("@")}
                  className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
                  style={{ background: C.iris, color: C.onPrimary }}>
                  {s.addAdmin}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
