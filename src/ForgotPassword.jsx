import { useState } from "react";
import { ArrowLeft, Eye, EyeOff, Loader2, CheckCircle2, MailCheck } from "lucide-react";
import { useC } from "./theme.jsx";
import BrandMark from "./BrandMark.jsx";
import { useLang } from "./i18n.jsx";
import LanguagePicker from "./LanguagePicker.jsx";
import ThemeToggle from "./ThemeToggle.jsx";

/* Forgotten password, in two steps on one screen.

   Step one asks who you are and mails a code. Step two takes the code and the
   new password together — splitting them costs a screen and gains nothing,
   since both are typed from the same message in the same minute.

   The server never says whether the address exists, so step one always
   advances. Somebody who mistyped their address finds out by not receiving
   mail, which is the only safe way to tell them. */
export default function ForgotPassword({ onBack, onReset, initialIdentifier = "" }) {
  const C = useC();
  const { t } = useLang();
  const [step, setStep] = useState("ask");
  const [identifier, setIdentifier] = useState(initialIdentifier);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /* Set when the server reports it has no mail provider attached, so a
     developer isn't left waiting for a message that was only ever logged. */
  const [noMail, setNoMail] = useState(false);

  const field = {
    background: C.surface,
    border: `1px solid ${C.hairline}`,
  };

  async function request(e) {
    e?.preventDefault();
    if (busy) return;
    if (!identifier.trim()) {
      setError(t.forgot.needIdentifier);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(t.forgot.failed);
        return;
      }
      setNoMail(data.mail === false);
      setStep("code");
    } catch {
      setError(t.login.offline);
    } finally {
      setBusy(false);
    }
  }

  async function submit(e) {
    e?.preventDefault();
    if (busy) return;
    if (code.trim().length < 6) {
      setError(t.forgot.needCode);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/reset", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim(), code: code.trim(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(t.forgot.errors[data.error] || t.forgot.failed);
        return;
      }
      setStep("done");
      // A beat on the confirmation, then straight into the app.
      setTimeout(() => onReset(data.token, data.username), 900);
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
            {t.forgot.panelTitle}
          </h2>
          <p className="mt-5 text-sm max-w-sm" style={{ color: C.panelMuted }}>
            {t.forgot.panelLead}
          </p>
        </div>
        <div className="data text-xs" style={{ color: C.panelMuted }}>{t.tagline}</div>
      </div>

      <div className="flex flex-col justify-center px-6 md:px-12 lg:px-20 py-12">
        <div className="w-full max-w-sm mx-auto">
          <div className="flex items-center justify-between gap-3 mb-10">
            <button
              onClick={onBack}
              className="inline-flex items-center gap-1.5 text-sm hover:opacity-70"
              style={{ color: C.slate }}
            >
              <ArrowLeft size={15} className="flip-rtl" /> {t.forgot.backToSignIn}
            </button>
            <div className="flex items-center gap-1.5 shrink-0">
              <LanguagePicker />
              <ThemeToggle compact />
            </div>
          </div>

          {step === "done" ? (
            <div className="slide-in">
              <CheckCircle2 size={30} style={{ color: C.iris }} className="mb-4" />
              <h1 className="display text-3xl font-extrabold mb-2">{t.forgot.doneTitle}</h1>
              <p className="text-sm" style={{ color: C.slate }}>{t.forgot.doneLead}</p>
            </div>
          ) : step === "ask" ? (
            <>
              <h1 className="display text-3xl font-extrabold mb-2">{t.forgot.title}</h1>
              <p className="text-sm mb-8" style={{ color: C.slate }}>{t.forgot.lead}</p>

              <form onSubmit={request}>
                <label htmlFor="fid" className="block text-sm font-semibold mb-1.5">{t.login.username}</label>
                <input
                  id="fid"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  autoComplete="username"
                  dir="ltr"
                  inputMode="email"
                  autoFocus
                  className="w-full rounded-lg px-4 py-3 mb-2 text-sm outline-none text-start"
                  style={field}
                />

                {error && (
                  <p className="text-sm mt-3 mb-1 slide-in" style={{ color: C.rose }} role="alert">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-lg py-3 font-semibold mt-5 inline-flex items-center justify-center gap-2 disabled:opacity-60"
                  style={{ background: C.iris, color: C.onPrimary }}
                >
                  {busy && <Loader2 size={16} className="animate-spin" />}
                  {busy ? t.forgot.sending : t.forgot.send}
                </button>
              </form>
            </>
          ) : (
            <>
              <MailCheck size={26} style={{ color: C.iris }} className="mb-4" />
              <h1 className="display text-3xl font-extrabold mb-2">{t.forgot.codeTitle}</h1>
              <p className="text-sm mb-8" style={{ color: C.slate }}>{t.forgot.codeLead}</p>

              {noMail && (
                <p className="text-xs mb-6 leading-relaxed rounded-lg p-3" style={{ color: C.slate, background: C.surface, border: `1px solid ${C.hairline}` }}>
                  {t.forgot.noMail}
                </p>
              )}

              <form onSubmit={submit}>
                <label htmlFor="fcode" className="block text-sm font-semibold mb-1.5">{t.forgot.codeLabel}</label>
                <input
                  id="fcode"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  dir="ltr"
                  autoFocus
                  className="w-full rounded-lg px-4 py-3 mb-5 text-lg data font-semibold tracking-[.3em] text-center outline-none"
                  style={field}
                />

                <label htmlFor="fpw" className="block text-sm font-semibold mb-1.5">{t.forgot.newPassword}</label>
                {/* Same LTR island as sign-in: credentials are Latin, so the
                    reveal button has to sit on the physical right in Arabic
                    too, or it lands on top of the text. */}
                <div className="relative mb-2" dir="ltr">
                  <input
                    id="fpw"
                    type={show ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    className="w-full rounded-lg px-4 py-3 pe-11 text-sm outline-none"
                    style={field}
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
                <p className="text-xs" style={{ color: C.slate }}>{t.forgot.rule}</p>

                {error && (
                  <p className="text-sm mt-4 slide-in" style={{ color: C.rose }} role="alert">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-lg py-3 font-semibold mt-5 inline-flex items-center justify-center gap-2 disabled:opacity-60"
                  style={{ background: C.iris, color: C.onPrimary }}
                >
                  {busy && <Loader2 size={16} className="animate-spin" />}
                  {busy ? t.forgot.saving : t.forgot.save}
                </button>
              </form>

              <p className="text-sm mt-6 text-center" style={{ color: C.slate }}>
                <button
                  onClick={() => { setStep("ask"); setError(""); setCode(""); }}
                  className="font-semibold"
                  style={{ color: C.iris }}
                >
                  {t.forgot.tryAgain}
                </button>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
