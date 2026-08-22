import { useState } from "react";
import { ArrowLeft, Eye, EyeOff, Loader2, AlertTriangle } from "lucide-react";
import { useC } from "./theme.jsx";
import NeonMark from "./NeonMark.jsx";
import { useLang } from "./i18n.jsx";
import LanguagePicker from "./LanguagePicker.jsx";
import ThemeToggle from "./ThemeToggle.jsx";

const ERRORS = {
  username: "errUsername",
  email: "errEmail",
  emailtaken: "errEmailTaken",
  short: "errShort",
  weak: "errWeak",
  taken: "errTaken",
  server: "errServer",
};

export default function Register({ onBack, onRegistered, onSignIn }) {
  const C = useC();
  const { t } = useLang();
  const [form, setForm] = useState({ email: "", username: "", password: "", confirm: "" });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [warn, setWarn] = useState("");

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e?.preventDefault();
    if (busy) return;

    if (form.password !== form.confirm) {
      setError(t.register.errMismatch);
      return;
    }

    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: form.username, email: form.email, password: form.password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(t.register[ERRORS[data.error] || "errServer"]);
        return;
      }

      /* If the deployment has no database, say so before they rely on it
         rather than after they lose the account. */
      if (!data.persistent) setWarn(t.register.warnNoStore);

      onRegistered(data.token, form.username, data.account);
    } catch {
      setError(t.register.errServer);
    } finally {
      setBusy(false);
    }
  }

  const field = {
    background: C.surface,
    border: `1px solid ${C.hairline}`,
    color: C.ink,
  };

  return (
    <div className="min-h-full grid lg:grid-cols-2" style={{ background: C.bone }}>
      <div className="hidden lg:flex flex-col justify-between p-14" style={{ background: C.panel }}>
        <div className="flex items-center gap-2">
          <NeonMark size={34} glow={0.9} />
          <span className="display font-extrabold text-lg" style={{ color: C.panelText }}>{t.name}</span>
        </div>
        <div>
          <h2
            className="display text-4xl font-extrabold leading-[1.2] max-w-md"
            style={{ color: C.panelText }}
          >
            {t.register.title}
          </h2>
          <p className="mt-5 text-sm max-w-sm" style={{ color: C.panelMuted }}>{t.register.lead}</p>
        </div>
        <div className="data text-xs" style={{ color: C.panelMuted }}>{t.tagline}</div>
      </div>

      <div className="flex flex-col justify-center px-6 md:px-12 lg:px-20 py-12">
        <div className="w-full max-w-sm mx-auto">
          <div className="flex items-center justify-between mb-8">
            <button
              onClick={onBack}
              className="inline-flex items-center gap-1.5 text-sm hover:opacity-70"
              style={{ color: C.slate }}
            >
              <ArrowLeft size={15} className="flip-rtl" /> {t.common.back}
            </button>
            <div className="flex items-center gap-2">
              <ThemeToggle compact />
              <LanguagePicker compact />
            </div>
          </div>

          <h1 className="display text-3xl font-extrabold mb-2">{t.register.nav}</h1>
          <p className="text-sm mb-8" style={{ color: C.slate }}>{t.register.lead}</p>

          {warn && (
            <div
              className="flex items-start gap-2.5 p-3 rounded-lg mb-5 text-xs leading-relaxed"
              style={{ background: C.lilacWash, color: C.ink }}
            >
              <AlertTriangle size={15} className="mt-0.5 shrink-0" style={{ color: C.lilac }} />
              {warn}
            </div>
          )}

          <form onSubmit={submit}>
            <label htmlFor="mail" className="block text-sm font-semibold mb-1.5">{t.register.email}</label>
            <input
              id="mail"
              type="email"
              value={form.email}
              onChange={set("email")}
              autoComplete="email"
              dir="ltr"
              className="w-full rounded-lg px-4 py-3 text-sm outline-none text-start"
              style={field}
            />
            <p className="text-[11px] mt-1 mb-4" style={{ color: C.slate }}>{t.register.emailHint}</p>

            <label htmlFor="user" className="block text-sm font-semibold mb-1.5">{t.register.username}</label>
            <input
              id="user"
              value={form.username}
              onChange={set("username")}
              autoComplete="username"
              dir="ltr"
              className="w-full rounded-lg px-4 py-3 text-sm outline-none text-start"
              style={field}
            />
            <p className="text-[11px] mt-1 mb-4" style={{ color: C.slate }}>{t.register.usernameHint}</p>

            <label htmlFor="pw" className="block text-sm font-semibold mb-1.5">{t.register.password}</label>
            <div className="relative" dir="ltr">
              <input
                id="pw"
                type={show ? "text" : "password"}
                value={form.password}
                onChange={set("password")}
                autoComplete="new-password"
                className="w-full rounded-lg px-4 py-3 pe-11 text-sm outline-none"
                style={field}
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="absolute end-3 top-3 z-10"
                style={{ color: C.slate }}
                aria-label={show ? t.login.hide : t.login.show}
              >
                {show ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
            <p className="text-[11px] mt-1 mb-4" style={{ color: C.slate }}>{t.register.passwordHint}</p>

            <label htmlFor="pw2" className="block text-sm font-semibold mb-1.5">{t.register.confirm}</label>
            <input
              id="pw2"
              type={show ? "text" : "password"}
              value={form.confirm}
              onChange={set("confirm")}
              autoComplete="new-password"
              dir="ltr"
              className="w-full rounded-lg px-4 py-3 text-sm outline-none mb-2"
              style={field}
            />

            {error && (
              <p className="text-sm mb-3 slide-in" style={{ color: C.rose }} role="alert">{error}</p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg py-3 font-semibold mt-4 inline-flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ background: C.iris, color: C.onPrimary }}
            >
              {busy && <Loader2 size={16} className="animate-spin" />}
              {busy ? t.register.creating : t.register.submit}
            </button>
          </form>

          <p className="text-sm mt-6 text-center" style={{ color: C.slate }}>
            {t.register.haveAccount}{" "}
            <button onClick={onSignIn} className="font-semibold" style={{ color: C.iris }}>
              {t.register.signIn}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
