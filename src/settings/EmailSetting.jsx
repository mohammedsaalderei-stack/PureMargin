import { useState } from "react";
import { Mail, Loader2, Check } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang } from "../i18n.jsx";

/* The sign-in email — add one, change it, or take it off the account.

   It asks for the current password, and the form says why rather than just
   demanding it: this address can reset the account, so whoever changes it
   unchallenged owns the account. That is worth one sentence of explanation.

   Emptying the field removes the address instead of failing validation. An
   account can legitimately have none — the username still signs in — but losing
   password reset is a real consequence, so the hint says so before it happens and
   the confirmation says so after.

   The form stays closed until asked for. Settings is read mostly to look
   something up, and three fields open by default read as work to be done. */

const ERRORS = {
  wrongcurrent: "errWrongCurrent",
  bademail: "errBadEmail",
  emailtaken: "errTaken",
};

export default function EmailSetting({ token, account, onAccountChange }) {
  const C = useC();
  const { t } = useLang();
  const s = t.emailChange;

  const current = account?.email || "";
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: current, current: "" });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [failed, setFailed] = useState(false);

  const fmt = (ms) => (ms ? new Date(ms).toLocaleString() : s.never);

  const start = () => {
    setForm({ email: current, current: "" });
    setNote("");
    setFailed(false);
    setOpen(true);
  };

  const save = async () => {
    setBusy(true);
    setNote("");
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email: form.email.trim(), current: form.current }),
      });
      const json = await res.json();
      if (!res.ok) {
        setFailed(true);
        setNote(s[ERRORS[json.error]] || s.errServer);
        return;
      }
      setFailed(false);
      setNote(json.account?.email ? s.saved : s.removed);
      setOpen(false);
      onAccountChange?.();
    } catch {
      setFailed(true);
      setNote(s.errServer);
    } finally {
      setBusy(false);
    }
  };

  const field = {
    className: "w-full rounded-lg px-3 py-2.5 text-sm outline-none text-start",
    style: { background: C.bone, border: `1px solid ${C.hairline}`, color: C.ink },
    dir: "ltr",
  };

  return (
    <div className="pt-4 mt-1" style={{ borderTop: `1px solid ${C.hairline}` }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold" style={{ color: C.slate }}>{s.title}</div>
          <div className="text-sm mt-0.5 truncate-safe" dir={current ? "ltr" : undefined}
            style={{ color: current ? C.ink : C.slate }}>
            {current || s.none}
          </div>
          <p className="text-[11px] mt-1" style={{ color: C.slate }}>{s.lead}</p>
        </div>
        {!open && (
          <button onClick={start}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0"
            style={{ border: `1px solid ${C.hairline}`, color: C.slate }}>
            {current ? s.edit : s.add}
          </button>
        )}
      </div>

      {open && (
        <div className="mt-4 space-y-3">
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: C.slate }}>
              {s.newEmail}
            </label>
            <input {...field} type="email" autoComplete="email" inputMode="email"
              value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <p className="text-[11px] mt-1.5" style={{ color: C.slate }}>{s.removeHint}</p>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: C.slate }}>
              {s.current}
            </label>
            <input {...field} type="password" autoComplete="current-password"
              value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} />
            <p className="text-[11px] mt-1.5" style={{ color: C.slate }}>{s.currentWhy}</p>
          </div>

          {note && <p className="text-sm" style={{ color: failed ? C.rose : C.iris }}>{note}</p>}

          <div className="flex flex-wrap gap-2">
            <button onClick={save} disabled={busy || !form.current}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
              style={{ background: C.iris, color: C.onPrimary }}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
              {busy ? s.saving : s.save}
            </button>
            <button onClick={() => { setOpen(false); setNote(""); }}
              className="px-4 py-2 rounded-lg text-sm font-semibold"
              style={{ border: `1px solid ${C.hairline}`, color: C.slate }}>
              {s.cancel}
            </button>
          </div>
        </div>
      )}

      {!open && (
        <>
          {note && (
            <p className="text-sm mt-3 inline-flex items-center gap-1.5"
              style={{ color: failed ? C.rose : C.iris }}>
              {!failed && <Check size={14} />}{note}
            </p>
          )}
          {account?.emailChangedAt && (
            <p className="text-[11px] mt-2" style={{ color: C.slate }}>
              {s.changed}: {fmt(account.emailChangedAt)}
            </p>
          )}
        </>
      )}
    </div>
  );
}
