import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2, UserPlus, KeyRound, LogIn, LogOut, Check, AlertTriangle,
  Archive, RotateCcw, Delete,
} from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill, localeFor } from "../i18n.jsx";
import { useFresh } from "../useFresh.jsx";

/* Who is here, and who was.

   ── The pad comes first ──────────────────────────────────────────────────

   This screen has two audiences and they are not equally frequent. Somebody
   arrives for a shift dozens of times a week; somebody adds an employee
   perhaps monthly. So the keypad is the screen, and the roster is underneath
   it — a device left on at the pass shows a code entry, not an admin table
   nobody standing in a doorway wants to read.

   ── One button, not two ──────────────────────────────────────────────────

   There is no "in" and "out" to choose between. The ledger already knows
   whether a person is currently in, so the punch decides for itself and says
   which it did. Asking is how somebody at the end of a twelve-hour shift taps
   the wrong one and the hours come out as a minute.

   ── The code is shown once ───────────────────────────────────────────────

   A new employee's PIN appears exactly once, here, on the screen of whoever
   added them. Nothing stores it in a readable form, so it cannot be looked up
   later — which is deliberate: a lost code is rotated, and rotation is the
   only thing that actually stops a code that has been passed around. */

const PAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"];

export default function Employees({ token, branches = [] }) {
  const C = useC();
  const { t, lang } = useLang();
  const s = t.employees;

  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  /* The last punch, kept on screen for a few seconds so somebody walking away
     sees that it registered and which way. */
  const [flash, setFlash] = useState(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", title: "", branchId: "" });
  /* A code, on screen once. Held in state rather than anywhere durable. */
  const [issued, setIssued] = useState(null);
  const flashTimer = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/employees?what=roster", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setState(await res.json());
    } catch { /* the next return will show what stuck */ } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);
  useFresh(load);

  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const locale = localeFor(lang);
  const clock = (ms) => {
    try {
      return new Date(ms).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
        .replace(/[‎‏‪-‮⁦-⁩]/g, "");
    } catch { return ""; }
  };
  /* Hours and minutes, never a decimal. "7h 20m" is a shift; "7.33" is a
     number somebody has to convert before it means anything. */
  const spell = (ms) => {
    const mins = Math.max(0, Math.round(ms / 60000));
    return fill(s.worked, { h: Math.floor(mins / 60), m: mins % 60 });
  };

  const employees = state?.employees || [];
  const present = new Map((state?.onShift || []).map((p) => [p.employeeId, p]));
  const nameOf = (id) => employees.find((e) => e.id === id)?.name || id;

  async function submitPin() {
    if (pin.length < 4 || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/employees?what=punch", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ pin, branchId: branches[0]?.id || branches[0] || "" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error === "nopin" ? s.noPin : s.errServer);
        setPin("");
        return;
      }
      setPin("");
      setFlash(json);
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), 8000);
      load();
    } catch {
      setError(s.errServer);
    } finally {
      setBusy(false);
    }
  }

  async function post(what, body) {
    setError("");
    const res = await fetch(`/api/employees?what=${what}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error === "duplicate" ? s.errDuplicate
        : json.error === "name" ? s.errName : s.errServer);
      return null;
    }
    await load();
    return json;
  }

  if (loading && !state) {
    return (
      <div className="h-full overflow-y-auto flex items-center justify-center p-8" style={{ color: C.slate }}>
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 md:p-6 space-y-4 max-w-2xl mx-auto w-full">
      {/* ── The pad ───────────────────────────────────────────────────── */}
      <section className="panel p-4 md:p-6">
        <h2 className="display font-bold text-base mb-1">{s.title}</h2>
        <p className="text-xs mb-4" style={{ color: C.slate }}>{s.lead}</p>

        {flash ? (
          <div className="rounded-xl p-4 text-center"
            style={{
              background: `color-mix(in srgb, ${flash.kind === "in" ? C.mint : C.iris} 12%, transparent)`,
              border: `1px solid color-mix(in srgb, ${flash.kind === "in" ? C.mint : C.iris} 40%, transparent)`,
            }}>
            <div className="flex items-center justify-center gap-2 text-sm font-bold"
              style={{ color: flash.kind === "in" ? C.mint : C.iris }}>
              {flash.kind === "in" ? <LogIn size={16} /> : <LogOut size={16} />}
              {fill(flash.kind === "in" ? s.welcomed : s.farewelled, { name: flash.name })}
            </div>
            <div className="text-xs mt-1" style={{ color: C.slate }}>
              {clock(flash.at)}
              {flash.kind === "out" && flash.workedMs ? ` · ${spell(flash.workedMs)}` : ""}
            </div>
          </div>
        ) : (
          <>
            {/* The code, never the digits. Somebody standing at a pass is in
                full view of the room. */}
            <div className="flex justify-center gap-2 mb-4" dir="ltr">
              {Array.from({ length: 6 }).map((_, i) => (
                <span key={i} className="w-3 h-3 rounded-full"
                  style={{
                    background: i < pin.length ? C.iris : "transparent",
                    border: `1.5px solid ${i < pin.length ? C.iris : C.hairline}`,
                  }} />
              ))}
            </div>

            <div className="grid grid-cols-3 gap-2 max-w-xs mx-auto" dir="ltr">
              {PAD.map((key, i) => key === "" ? <span key={i} /> : (
                <button key={i} type="button" disabled={busy}
                  onClick={() => {
                    setError("");
                    if (key === "back") setPin((p) => p.slice(0, -1));
                    else setPin((p) => (p.length >= 8 ? p : p + key));
                  }}
                  className="py-3 rounded-xl text-lg font-bold disabled:opacity-50"
                  style={{ background: "var(--chip-bg)", color: C.ink }}>
                  {key === "back" ? <Delete size={18} className="mx-auto" /> : key}
                </button>
              ))}
            </div>

            <button type="button" onClick={submitPin} disabled={busy || pin.length < 4}
              className="mt-3 w-full max-w-xs mx-auto flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold disabled:opacity-40"
              style={{ background: C.iris, color: C.onPrimary }}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
              {s.punch}
            </button>
          </>
        )}

        {error && (
          <p className="text-xs mt-3 flex items-center justify-center gap-1.5" style={{ color: C.rose }}>
            <AlertTriangle size={13} /> {error}
          </p>
        )}
      </section>

      {/* ── Who is in ─────────────────────────────────────────────────── */}
      <section className="panel p-4 md:p-5">
        <h3 className="display font-bold text-sm mb-3">
          {fill(s.onShift, { n: present.size })}
        </h3>
        {present.size === 0 ? (
          <p className="text-xs" style={{ color: C.slate }}>{s.nobodyIn}</p>
        ) : (
          <div className="space-y-1.5">
            {[...present.values()].map((p) => (
              <div key={p.employeeId}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg"
                style={{ background: "var(--chip-bg)" }}>
                <span className="text-sm font-semibold truncate">{nameOf(p.employeeId)}</span>
                <span className="text-[11px] shrink-0" style={{ color: C.mint }}>
                  {fill(s.sinceTime, { time: clock(p.since) })}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── The roster ────────────────────────────────────────────────── */}
      <section className="panel p-4 md:p-5">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <h3 className="display font-bold text-sm">{s.roster}</h3>
          <button type="button" onClick={() => { setAdding((v) => !v); setIssued(null); }}
            className="text-xs font-semibold flex items-center gap-1.5" style={{ color: C.iris }}>
            <UserPlus size={13} /> {s.add}
          </button>
        </div>

        {/* The code, once. */}
        {issued && (
          <div className="rounded-xl p-4 mb-3 text-center"
            style={{
              background: "color-mix(in srgb, var(--iris) 12%, transparent)",
              border: `1px solid color-mix(in srgb, var(--iris) 40%, transparent)`,
            }}>
            <p className="text-xs mb-1" style={{ color: C.slate }}>
              {fill(s.pinFor, { name: issued.name })}
            </p>
            <p className="data text-3xl font-bold tracking-[0.3em]" dir="ltr" style={{ color: C.iris }}>
              {issued.pin}
            </p>
            <p className="text-[11px] mt-2" style={{ color: C.amber }}>{s.pinOnce}</p>
            <button type="button" onClick={() => setIssued(null)}
              className="mt-2 text-xs font-semibold" style={{ color: C.slate }}>
              {s.pinNoted}
            </button>
          </div>
        )}

        {adding && (
          <form className="grid gap-2 mb-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const out = await post("add", draft);
              if (!out) return;
              setIssued({ name: out.employee.name, pin: out.pin });
              setDraft({ name: "", title: "", branchId: "" });
              setAdding(false);
            }}>
            <input required value={draft.name} placeholder={s.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              className="px-3 py-2 rounded-lg text-sm"
              style={{ background: C.surface, border: `1px solid ${C.hairline}`, color: C.ink }} />
            <input value={draft.title} placeholder={s.jobTitle}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              className="px-3 py-2 rounded-lg text-sm"
              style={{ background: C.surface, border: `1px solid ${C.hairline}`, color: C.ink }} />
            {branches.length > 1 && (
              <select value={draft.branchId}
                onChange={(e) => setDraft((d) => ({ ...d, branchId: e.target.value }))}
                className="px-3 py-2 rounded-lg text-sm"
                style={{ background: C.surface, border: `1px solid ${C.hairline}`, color: C.ink }}>
                <option value="">{s.anyBranch}</option>
                {branches.map((b) => (
                  <option key={b.id || b} value={b.id || b}>{b.name || b}</option>
                ))}
              </select>
            )}
            <button type="submit"
              className="px-4 py-2 rounded-lg text-sm font-bold"
              style={{ background: C.iris, color: C.onPrimary }}>
              {s.addAndIssue}
            </button>
          </form>
        )}

        {employees.length === 0 ? (
          <p className="text-xs" style={{ color: C.slate }}>{s.empty}</p>
        ) : (
          <div className="space-y-1.5">
            {employees.map((e) => (
              <div key={e.id} className="flex items-center gap-2 px-3 py-2 rounded-lg flex-wrap"
                style={{ background: "var(--chip-bg)" }}>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate">{e.name}</div>
                  <div className="text-[11px] truncate" style={{ color: C.slate }}>
                    {[e.title, state?.branchNames?.[e.branchId]].filter(Boolean).join(" · ")
                      || s.noTitle}
                  </div>
                </div>
                {present.has(e.id) && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded"
                    style={{ background: `color-mix(in srgb, ${C.mint} 16%, transparent)`, color: C.mint }}>
                    {s.inNow}
                  </span>
                )}
                <button type="button" title={s.rotate}
                  onClick={async () => {
                    const out = await post("rotate", { id: e.id });
                    if (out) setIssued({ name: out.employee.name, pin: out.pin });
                  }}
                  className="p-1.5 rounded" style={{ color: C.slate }}>
                  <KeyRound size={14} />
                </button>
                <button type="button" title={s.archive}
                  onClick={() => post("archive", { id: e.id, archived: true })}
                  className="p-1.5 rounded" style={{ color: C.slate }}>
                  <Archive size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Today ─────────────────────────────────────────────────────── */}
      {state?.today?.length > 0 && (
        <section className="panel p-4 md:p-5">
          <h3 className="display font-bold text-sm mb-3 flex items-center gap-2">
            <RotateCcw size={14} style={{ color: C.iris }} /> {s.today}
          </h3>
          <div className="space-y-1">
            {state.today.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 text-xs py-1.5">
                <span className="truncate">{nameOf(p.employeeId)}</span>
                <span className="shrink-0 flex items-center gap-1.5"
                  style={{ color: p.kind === "in" ? C.mint : C.slate }}>
                  {p.kind === "in" ? <LogIn size={12} /> : <LogOut size={12} />}
                  {clock(p.at)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
      </div>
    </div>
  );
}

