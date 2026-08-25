import { useState } from "react";
import { AtSign, Loader2, Check } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang } from "../i18n.jsx";
import { Req } from "../Required.jsx";

/* Changing the username.

   The password is asked for because the username is half a credential: it is
   what the account signs in with, and letting an unattended open session
   rename it would hand somebody a working login rather than just a changed
   label.

   Renaming invalidates every token issued under the old name, this session's
   included, so the endpoint returns a fresh one and the caller swaps it in.
   Without that the person is signed out by a change they just made on
   purpose, which reads as the app breaking.

   Closed until asked for, like the email form beside it. */

const ERRORS = {
  wrongcurrent: "usernameWrongPw",
  taken: "usernameTaken",
  username: "usernameBad",
};

export default function UsernameSetting({ token, account, onAccountChange, onSession }) {
  const C = useC();
  const { t } = useLang();
  const s = t.settings;

  const current = account?.username || "";
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ username: current, current: "" });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [failed, setFailed] = useState(false);

  const start = () => {
    setForm({ username: current, current: "" });
    setNote("");
    setFailed(false);
    setOpen(true);
  };

  const save = async () => {
    setBusy(true);
    setNote("");
    try {
      const res = await fetch("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ username: form.username.trim(), current: form.current }),
      });
      const json = await res.json();
      if (!res.ok) {
        setFailed(true);
        setNote(s[ERRORS[json.error]] || t.emailChange.errServer);
        return;
      }
      setFailed(false);
      setNote(s.usernameDone);
      setOpen(false);
      /* The token that got us here no longer works. Swap first, then refresh,
         or the refresh authenticates with a token the rename just retired. */
      if (json.token) onSession?.(json.token, json.account?.username);
      onAccountChange?.();
    } catch {
      setFailed(true);
      setNote(t.emailChange.errServer);
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
    <section className="rounded-2xl border p-5" style={{ borderColor: C.hairline }}>
      <div className="flex items-start gap-3">
        <AtSign size={18} className="mt-0.5 shrink-0" style={{ color: C.iris }} />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold">{s.usernameTitle}</h3>
          <p className="text-xs mt-0.5" style={{ color: C.slate }}>{s.usernameLead}</p>

          {!open && (
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              <code
                className="text-sm px-2 py-1 rounded"
                style={{ background: C.bone, color: C.ink }}
                dir="ltr"
              >
                {current}
              </code>
              <button
                type="button"
                onClick={start}
                className="text-xs font-bold underline"
                style={{ color: C.iris }}
              >
                {s.usernameSave}
              </button>
            </div>
          )}

          {open && (
            <div className="mt-4 flex flex-col gap-3">
              <div>
                <label htmlFor="newuser" className="block text-xs font-semibold mb-1.5">
                  {s.usernameNew}<Req />
                </label>
                <input
                  id="newuser"
                  value={form.username}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                  autoComplete="username"
                  {...field}
                />
              </div>

              <div>
                <label htmlFor="userpw" className="block text-xs font-semibold mb-1.5">
                  {t.emailChange.current}<Req />
                </label>
                <input
                  id="userpw"
                  type="password"
                  value={form.current}
                  onChange={(e) => setForm((f) => ({ ...f, current: e.target.value }))}
                  autoComplete="current-password"
                  {...field}
                />
              </div>

              <p className="text-[11px]" style={{ color: C.slate }}>{s.usernameNote}</p>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={save}
                  disabled={busy || !form.username.trim() || !form.current}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold disabled:opacity-50"
                  style={{ background: C.iris, color: C.onPrimary }}
                >
                  {busy && <Loader2 size={13} className="animate-spin" />}
                  {busy ? s.usernameSaving : s.usernameSave}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-xs font-semibold"
                  style={{ color: C.slate }}
                >
                  {t.emailChange.cancel}
                </button>
              </div>
            </div>
          )}

          {note && (
            <p
              className="text-xs mt-3 flex items-center gap-1"
              style={{ color: failed ? C.rose : C.cyan }}
            >
              {!failed && <Check size={13} />} {note}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
