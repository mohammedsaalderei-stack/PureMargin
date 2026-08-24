import { useState } from "react";
import { Loader2, Plug, X, Table2 } from "lucide-react";
import { useC } from "./theme.jsx";
import { useLang } from "./i18n.jsx";

/* Shown once after registering, and available from Settings afterwards.
   Dismissing it is a real choice, not a delay tactic — the app works on
   sample figures and says so, and the same form waits in Settings. */
export function ConnectDialog({ open, onClose, onConnected, token, dismissible = true }) {
  const C = useC();
  const { t } = useLang();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  async function save() {
    if (!value.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/account", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ posToken: value.trim() }),
      });
      if (!res.ok) throw new Error();
      setValue("");
      onConnected();
    } catch {
      setError(t.connect.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center sm:p-4"
      style={{ background: C.scrim, backdropFilter: "blur(3px)" }}
      onClick={dismissible ? onClose : undefined}
    >
      <div
        className="palette-in w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden"
        style={{ background: C.surface, border: `1px solid ${C.hairline}` }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="p-6 pb-4">
          <div className="flex items-start justify-between mb-4">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: C.irisWash }}>
              <Plug size={18} style={{ color: C.iris }} />
            </div>
            {dismissible && (
              <button onClick={onClose} aria-label={t.connect.later} style={{ color: C.slate }}>
                <X size={18} />
              </button>
            )}
          </div>

          <h3 className="display font-extrabold text-xl mb-2">{t.connect.title}</h3>
          <p className="text-sm leading-relaxed mb-4" style={{ color: C.slate }}>{t.connect.lead}</p>

          <div
            className="text-xs px-3 py-2 rounded-lg mb-4"
            style={{ background: C.bone, color: C.slate }}
            dir="ltr"
          >
            {t.connect.where}
          </div>

          <label className="block text-sm font-semibold mb-1.5">{t.connect.token}</label>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            placeholder={t.connect.placeholder}
            dir="ltr"
            className="w-full rounded-lg px-4 py-3 text-sm outline-none text-start"
            style={{ background: C.bone, border: `1px solid ${C.hairline}`, color: C.ink }}
          />

          {error && <p className="text-sm mt-3" style={{ color: C.rose }}>{error}</p>}

          <p className="text-[11px] mt-3 leading-relaxed" style={{ color: C.slate }}>
            {t.connect.posNote}
          </p>
        </div>

        <div className="px-6 pb-6 flex gap-2">
          <button
            onClick={save}
            disabled={busy || !value.trim()}
            className="flex-1 rounded-lg py-2.5 text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: C.iris, color: C.onPrimary }}
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {busy ? t.connect.saving : t.connect.save}
          </button>
          {dismissible && (
            <button
              onClick={onClose}
              className="px-4 rounded-lg text-sm font-semibold"
              style={{ border: `1px solid ${C.hairline}`, color: C.slate }}
            >
              {t.connect.later}
            </button>
          )}
        </div>

        {dismissible && (
          <p className="px-6 pb-5 text-[11px] leading-relaxed" style={{ color: C.slate }}>
            {t.connect.skipNote}
          </p>
        )}
      </div>
    </div>
  );
}

/* What sits behind the dialog on a brand-new account: an honestly empty
   table rather than a dashboard full of numbers that aren't theirs. */
export function EmptyTable({ onConnect }) {
  const C = useC();
  const { t } = useLang();
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <div
          className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center mb-5"
          style={{ background: C.irisWash }}
        >
          <Table2 size={24} style={{ color: C.iris }} />
        </div>
        <h3 className="display font-extrabold text-xl mb-2">{t.connect.emptyTitle}</h3>
        <p className="text-sm leading-relaxed mb-6" style={{ color: C.slate }}>{t.connect.emptyLead}</p>
        <button
          onClick={onConnect}
          className="px-5 py-2.5 rounded-lg text-sm font-semibold"
          style={{ background: C.iris, color: C.onPrimary }}
        >
          {t.connect.emptyAction}
        </button>
      </div>
    </div>
  );
}
