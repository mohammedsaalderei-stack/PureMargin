import { useState } from "react";
import { ArrowLeft, Eye, EyeOff, Loader2 } from "lucide-react";
import { useC } from "./theme.jsx";
import BrandMark from "./BrandMark.jsx";
import { useLang } from "./i18n.jsx";
import LanguagePicker from "./LanguagePicker.jsx";

export default function Login({ onAuthed, onBack, onRegister }) {
  const C = useC();
  const { t } = useLang();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e?.preventDefault();
    if (busy) return;
    if (!password) {
      setError(t.login.needPassword);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email: username.includes("@") ? username : "", password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(t.login.wrong);
        return;
      }
      sessionStorage.setItem("sufra_token", data.token);
      sessionStorage.setItem("sufra_user", username || "user");
      onAuthed(data.token, username);
    } catch {
      setError(t.login.offline);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full grid lg:grid-cols-2" style={{ background: C.bone }}>
      <div className="hidden lg:flex flex-col justify-between p-14" style={{ background: C.panel }}>
        <div className="flex items-center gap-2">
          <BrandMark size={34} />
          <span className="display font-extrabold text-lg" style={{ color: C.panelText }}>{t.name}</span>
        </div>
        <div>
          <h2 className="display text-4xl font-extrabold leading-[1.2] max-w-md" style={{ color: C.panelText }}>
            {t.login.panelTitle}
          </h2>
          <p className="mt-5 text-sm max-w-sm" style={{ color: C.panelMuted }}>
            {t.login.panelLead}
          </p>
        </div>
        <div className="data text-xs" style={{ color: C.panelMuted }}>{t.tagline}</div>
      </div>

      <div className="flex flex-col justify-center px-6 md:px-12 lg:px-20 py-12">
        <div className="w-full max-w-sm mx-auto">
          <div className="flex items-center justify-between mb-10">
            <button
              onClick={onBack}
              className="inline-flex items-center gap-1.5 text-sm hover:opacity-70"
              style={{ color: C.slate }}
            >
              <ArrowLeft size={15} className="flip-rtl" /> {t.common.back}
            </button>
<LanguagePicker />
          </div>

          <h1 className="display text-3xl font-extrabold mb-2">{t.login.title}</h1>
          <p className="text-sm mb-8" style={{ color: C.slate }}>{t.login.lead}</p>

          <form onSubmit={submit}>
            <label htmlFor="u" className="block text-sm font-semibold mb-1.5">{t.login.username}</label>
            <input
              id="u"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              dir="ltr"
              inputMode="email"
              className="w-full rounded-lg px-4 py-3 mb-5 text-sm outline-none text-start"
              style={{ background: C.surface, border: `1px solid ${C.hairline}` }}
            />

            <label htmlFor="p" className="block text-sm font-semibold mb-1.5">{t.login.password}</label>
            {/* Credentials are Latin, so the field is an LTR island — the
                wrapper carries dir too, or the icon resolves to the physical
                left in Arabic and sits on top of the text. */}
            <div className="relative mb-2" dir="ltr">
              <input
                id="p"
                type={show ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="w-full rounded-lg px-4 py-3 pe-11 text-sm outline-none"
                style={{ background: C.surface, border: `1px solid ${C.hairline}` }}
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute end-3 top-3 z-10"
                style={{ color: C.slate }}
                aria-label={show ? t.login.hide : t.login.show}
              >
                {show ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>

            {error && (
              <p className="text-sm mb-4 slide-in" style={{ color: C.rose }} role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg py-3  font-semibold mt-4 inline-flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ background: C.iris, color: C.onPrimary }}
            >
              {busy && <Loader2 size={16} className="animate-spin" />}
              {busy ? t.login.signingIn : t.login.title}
            </button>
          </form>

          <p className="text-sm mt-6 text-center" style={{ color: C.slate }}>
            {t.register.noAccount}{" "}
            <button onClick={onRegister} className="font-semibold" style={{ color: C.iris }}>
              {t.register.nav}
            </button>
          </p>

          <p className="text-xs mt-6 leading-relaxed" style={{ color: C.slate }}>
            {t.login.note}
          </p>
        </div>
      </div>
    </div>
  );
}
