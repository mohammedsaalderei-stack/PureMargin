import { useEffect, useRef, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { useC } from "./theme.jsx";
import { useLang } from "./i18n.jsx";

const REASONS = ["wrongNumbers", "missedPoint", "tooVague", "wrongLanguage", "other"];

export default function FeedbackDialog({ open, onClose, onSent, token, question, answer }) {
  const C = useC();
  const { t, lang } = useLang();
  const [reason, setReason] = useState("wrongNumbers");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const firstRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setReason("wrongNumbers");
    setDetail("");
    setError("");
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    setTimeout(() => firstRef.current?.focus(), 40);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ question, answer, reason, detail, lang }),
      });
      if (!res.ok) throw new Error();
      onSent();
      onClose();
    } catch {
      setError(t.feedback.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
      style={{ background: C.scrim, backdropFilter: "blur(3px)" }}
      onClick={onClose}
    >
      <div
        className="palette-in w-full sm:max-w-md rounded-t-2xl sm:rounded-xl overflow-hidden"
        style={{ background: C.surface, border: `1px solid ${C.hairline}` }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between p-5 pb-3">
          <div>
            <h3 className="display font-extrabold text-lg">{t.feedback.title}</h3>
            <p className="text-xs mt-1" style={{ color: C.slate }}>{t.feedback.lead}</p>
          </div>
          <button onClick={onClose} aria-label={t.feedback.cancel} style={{ color: C.slate }}>
            <X size={18} />
          </button>
        </div>

        <div className="px-5 pb-5">
          <div className="flex flex-wrap gap-2 mb-4">
            {REASONS.map((r, i) => {
              const on = reason === r;
              return (
                <button
                  key={r}
                  ref={i === 0 ? firstRef : null}
                  onClick={() => setReason(r)}
                  className="text-xs font-semibold px-3 py-2 rounded-lg"
                  style={{
                    background: on ? C.irisWash : "transparent",
                    border: `1px solid ${on ? C.iris : C.hairline}`,
                    color: on ? C.irisDeep : C.slate,
                  }}
                >
                  {t.feedback[r]}
                </button>
              );
            })}
          </div>

          <textarea
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            rows={3}
            placeholder={t.feedback.detail}
            className="w-full rounded-lg px-3 py-2.5 text-sm outline-none resize-none"
            style={{ background: C.bone, border: `1px solid ${C.hairline}` }}
          />

          {error && <p className="text-sm mt-3" style={{ color: C.rose }}>{error}</p>}

          <div className="flex gap-2 mt-4">
            <button
              onClick={submit}
              disabled={busy}
              className="flex-1 rounded-lg py-2.5  text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ background: C.iris, color: C.onPrimary }}
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              {busy ? t.feedback.sending : t.feedback.send}
            </button>
            <button
              onClick={onClose}
              className="px-4 rounded-lg text-sm font-semibold"
              style={{ border: `1px solid ${C.hairline}`, color: C.slate }}
            >
              {t.feedback.cancel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
