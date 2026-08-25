import { useState, useEffect, useRef, useCallback } from "react";
import { AlertTriangle, Send, Loader2, Users, Check } from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill, formatDate } from "../i18n.jsx";

/* The team's own board.

   Deliberately one stream, not threads. A restaurant team writing to each
   other between shifts wants the last thing said, not a tree to navigate, and
   threads would have meant deciding where a reply to a two-week-old
   announcement belongs. If that becomes a real complaint, it is an additive
   change; guessing at it now would be a structure nobody asked for. */

function Chip({ on, children, onClick, C }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className="px-2.5 py-1 rounded-full text-[12px] font-semibold border transition-colors"
      style={{
        borderColor: on ? C.iris : C.hairline,
        background: on ? `${C.iris}1A` : "transparent",
        color: on ? C.iris : C.slate,
      }}
    >
      {children}
    </button>
  );
}

export default function Messages({ token }) {
  const C = useC();
  const { t, lang } = useLang();
  const s = t.messages;

  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [important, setImportant] = useState(false);
  const [branches, setBranches] = useState([]);
  const [roles, setRoles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const foot = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/messages", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("load");
      setState(await res.json());
    } catch {
      setError(s.errServer);
    } finally {
      setLoading(false);
    }
  }, [token, s.errServer]);

  useEffect(() => { load(); }, [load]);

  /* Mark the board read once it has actually been rendered, not on mount —
     otherwise a failed load would clear the badge without showing anything. */
  useEffect(() => {
    if (!state) return;
    fetch("/api/messages", { method: "PUT", headers: { Authorization: `Bearer ${token}` } })
      .catch(() => {});
    foot.current?.scrollIntoView({ block: "end" });
  }, [state, token]);

  const toggle = (list, setList, value) =>
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  async function post() {
    if (!body.trim()) { setError(s.errEmpty); return; }
    setBusy(true); setError(""); setNote("");
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ body, important, branches, roles }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error === "empty" ? s.errEmpty : data.error === "long" ? s.errLong : s.errServer);
        return;
      }
      if (important) {
        setNote(data.notified ? fill(s.notified, { count: data.notified }) : s.notifiedNone);
      }
      setBody(""); setImportant(false); setBranches([]); setRoles([]);
      await load();
    } catch {
      setError(s.errServer);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm p-6" style={{ color: C.slate }}>
        <Loader2 size={15} className="animate-spin" /> {s.loading}
      </div>
    );
  }

  const messages = state?.messages || [];
  const mayFlag = Boolean(state?.mayFlag);

  return (
    <div className="max-w-3xl mx-auto w-full flex flex-col gap-4">
      <header>
        <h1 className="display text-2xl font-extrabold">{s.title}</h1>
        <p className="text-sm mt-1" style={{ color: C.slate }}>{s.lead}</p>
      </header>

      <div className="flex flex-col gap-3">
        {messages.length === 0 && (
          <p className="text-sm py-10 text-center" style={{ color: C.slate }}>{s.empty}</p>
        )}

        {messages.map((msg) => {
          const mine = msg.author === state.me;
          const names = [
            ...msg.audience.branches.map((id) =>
              (state.branches.find((b) => b.id === id) || {}).name || id),
            ...msg.audience.roles.map((key) =>
              (state.roles.find((r) => r.key === key) || {}).label || key),
          ];
          return (
            <article
              key={msg.id}
              className="rounded-2xl border p-4"
              style={{
                borderColor: msg.important ? `${C.iris}66` : C.hairline,
                background: msg.important ? `${C.iris}0D` : C.surface,
              }}
            >
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <span className="text-sm font-bold">{mine ? s.you : msg.author}</span>
                <span className="text-[11px]" style={{ color: C.slate }}>
                  {formatDate(msg.at, lang)}
                </span>
                {msg.important && (
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold"
                    style={{ background: `${C.iris}1F`, color: C.iris }}
                  >
                    <AlertTriangle size={11} /> {s.important}
                  </span>
                )}
                {msg.forMe && !mine && (
                  <span className="text-[11px] font-semibold" style={{ color: C.iris }}>
                    {s.forMe}
                  </span>
                )}
              </div>

              <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.body}</p>

              <p className="text-[11px] mt-2 flex items-center gap-1" style={{ color: C.slate }}>
                <Users size={11} />
                {msg.everyone ? s.everyone : names.join(" · ")}
              </p>
            </article>
          );
        })}
        <div ref={foot} />
      </div>

      <div className="rounded-2xl border p-4 sticky bottom-0" style={{ borderColor: C.hairline, background: C.surface }}>
        <label htmlFor="msg" className="sr-only">{s.placeholder}</label>
        <textarea
          id="msg"
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={s.placeholder}
          maxLength={state?.maxLength || 4000}
          className="w-full rounded-xl border px-3 py-2 text-sm resize-y"
          style={{ borderColor: C.hairline, background: C.bone, color: C.ink }}
        />

        {mayFlag && (
          <div className="mt-3 flex flex-col gap-2">
            <label className="flex items-start gap-2 text-sm font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={important}
                onChange={(e) => setImportant(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                {s.important}
                <span className="block text-[11px] font-normal" style={{ color: C.slate }}>
                  {s.importantHint}
                </span>
              </span>
            </label>

            {important && (
              <div className="flex flex-col gap-2 pt-1">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: C.slate }}>
                    {s.branches}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <Chip C={C} on={branches.length === 0} onClick={() => setBranches([])}>
                      {s.branchesAll}
                    </Chip>
                    {(state.branches || []).map((b) => (
                      <Chip key={b.id} C={C} on={branches.includes(b.id)}
                            onClick={() => toggle(branches, setBranches, b.id)}>
                        {b.name}
                      </Chip>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: C.slate }}>
                    {s.roles}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <Chip C={C} on={roles.length === 0} onClick={() => setRoles([])}>
                      {s.rolesAll}
                    </Chip>
                    {(state.roles || []).map((r) => (
                      <Chip key={r.key} C={C} on={roles.includes(r.key)}
                            onClick={() => toggle(roles, setRoles, r.key)}>
                        {r.label}
                      </Chip>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {!mayFlag && (
          <p className="text-[11px] mt-2" style={{ color: C.slate }}>{s.onlyOwner}</p>
        )}

        {error && <p className="text-sm mt-2" style={{ color: C.rose }}>{error}</p>}
        {note && (
          <p className="text-sm mt-2 flex items-center gap-1" style={{ color: C.cyan }}>
            <Check size={14} /> {note}
          </p>
        )}

        <button
          type="button"
          onClick={post}
          disabled={busy || !body.trim()}
          className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold disabled:opacity-50"
          style={{ background: C.iris, color: "#fff" }}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {busy ? s.sending : s.send}
        </button>
      </div>
    </div>
  );
}
