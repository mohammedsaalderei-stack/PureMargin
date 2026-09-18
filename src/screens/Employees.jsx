import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Loader2, UserPlus, LogIn, LogOut, AlertTriangle, Archive, Camera,
  Check, Copy, ExternalLink, ImageOff, Smartphone, Trash2, UserCheck, X,
} from "lucide-react";
import { useC } from "../theme.jsx";
import { useLang, fill, localeFor } from "../i18n.jsx";
import { useFresh } from "../useFresh.jsx";

/* Who is here, who was, and what they photographed on the way in.

   ── There used to be a keypad on this screen ─────────────────────────────

   It was the screen, in fact: a six-digit code, typed on a device left signed
   in at the pass, with the roster underneath. It is gone, and so is the code.
   Attendance is recorded on `#/attendance` now — the arriving person, on their
   own phone, with a photograph of the place — so the pad had become a second
   way to do one thing, and the weaker of the two.

   What is left here is the other audience, which was always the smaller one:
   reading what was recorded, keeping the roster, and clearing up after it.

   ── The photograph is the point of the day's list ────────────────────────

   A row that says "Aisha, 06:12" is a claim. The same row with a picture of
   the shutter half up outside the restaurant is something an owner can check
   in the second it takes to glance at it, which is the only amount of time
   anybody will ever give this.

   So the pictures are in the list, small, already loaded — not behind a link
   that has to be clicked forty times. The full-size one is one tap away for
   the row that looks wrong.

   ── And they can be deleted ──────────────────────────────────────────────

   The picture, not the punch. Somebody's hours come out of the punch and it is
   a ledger entry like every other in this codebase: appended, never edited.
   The photograph is a picture of a workplace taken on a personal phone, an
   owner may have every reason to want it gone, and the row says so afterwards
   rather than quietly looking like a punch that never had one. */

export default function Employees({ token, branches = [] }) {
  const C = useC();
  const { t, lang } = useLang();
  const s = t.employees;

  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", title: "", branchId: "" });
  const [copied, setCopied] = useState(false);
  /* The punch whose full-size photograph is open, and the one whose removal
     has been asked for but not yet confirmed. */
  const [viewing, setViewing] = useState(null);
  const [confirming, setConfirming] = useState("");
  const [busy, setBusy] = useState("");
  const copyTimer = useRef(null);

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
  useEffect(() => () => clearTimeout(copyTimer.current), []);

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
  const thumbs = state?.thumbs || {};
  const today = state?.today || [];
  const nameOf = (id) => employees.find((e) => e.id === id)?.name || id;

  /* How long that stretch ran, for a departure.

     Worked out from the two entries rather than stored with either, the same
     way a stock balance is the sum of its movements — a shift length written
     onto a punch would be a third copy of a fact already recorded twice.

     The list arrives newest first, so the matching arrival is further down it.
     Nothing is shown when there isn't one: somebody who clocked out on a shift
     that started before midnight has no arrival in today's list, and inventing
     a length from the first entry of the day would put a fourteen-hour shift on
     a row that should simply be quiet about it. */
  const ranFor = (punch, index) => {
    if (punch.kind !== "out") return "";
    const start = today.slice(index + 1).find((p) => p.employeeId === punch.employeeId && p.kind === "in");
    return start ? spell(punch.at - start.at) : "";
  };

  async function post(what, body) {
    setError("");
    try {
      const res = await fetch(`/api/employees?what=${what}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error === "duplicate" ? s.errDuplicate
          : json.error === "name" ? s.errName
            : json.error === "noperson" ? s.errPerson : s.errServer);
        return null;
      }
      await load();
      return json;
    } catch {
      setError(s.errServer);
      return null;
    }
  }

  /* The switches are flipped on screen before the server answers.

     A toggle that waits for a round trip feels broken on a phone, and both of
     these are cheap to be wrong about for a second: the reload that follows
     puts back whatever the server actually decided. */
  async function toggle(key, value) {
    setState((prev) => ({ ...prev, [key]: value }));
    await post("settings", { [key]: value });
  }

  async function openPhoto(punch) {
    setViewing({ id: punch.id, punch, url: "", loading: true });
    try {
      const res = await fetch(`/api/employees?what=photo&id=${encodeURIComponent(punch.id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      setViewing({ id: punch.id, punch, url: res.ok ? json.url : "", loading: false });
    } catch {
      setViewing({ id: punch.id, punch, url: "", loading: false });
    }
  }

  async function removePhoto(id) {
    setBusy(id);
    const out = await post("unphoto", { id });
    setBusy("");
    setConfirming("");
    if (out && viewing?.id === id) setViewing(null);
  }

  const copyLink = async () => {
    const url = state?.clockInUrl || "";
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2500);
    } catch {
      /* Clipboard refused — an insecure origin, or a browser that wants a
         gesture it did not see. Selecting the text is still a way to copy it,
         so the address stays on screen and readable rather than being replaced
         by a confirmation that would be a lie. */
      setError(s.errCopy);
    }
  };

  if (loading && !state) {
    return (
      <div className="h-full overflow-y-auto flex items-center justify-center p-8" style={{ color: C.slate }}>
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  const Toggle = ({ on, onChange, label, lead }) => (
    <label className="flex items-start gap-3 py-2.5 cursor-pointer">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 shrink-0 mt-0.5" style={{ accentColor: C.iris }} />
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-[11px]" style={{ color: C.slate }}>{lead}</span>
      </span>
    </label>
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 md:p-6 space-y-4 max-w-2xl mx-auto w-full">

        {/* ── The address staff use ──────────────────────────────────── */}
        <section className="panel p-4 md:p-6">
          <h2 className="display font-bold text-base mb-1">{s.title}</h2>
          <p className="text-xs mb-4" style={{ color: C.slate }}>{s.lead}</p>

          <div className="rounded-xl p-3 mb-3" style={{ background: "var(--chip-bg)" }}>
            <div className="text-[11px] mb-1.5 flex items-center gap-1.5" style={{ color: C.slate }}>
              <Smartphone size={12} /> {s.linkTitle}
            </div>
            {/* `select-all` and `break-all`: this is an address somebody reads
                out loud or copies, and one that wraps mid-word beats one that
                runs off the side of a phone. */}
            <div className="data text-xs font-semibold select-all break-all mb-2.5" dir="ltr">
              {state?.clockInUrl}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" onClick={copyLink}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold"
                style={{ background: C.iris, color: C.onPrimary }}>
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? s.copied : s.copy}
              </button>
              <a href={state?.clockInUrl} target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold"
                style={{ border: `1px solid ${C.hairline}`, color: C.ink }}>
                <ExternalLink size={13} /> {s.openLink}
              </a>
            </div>
          </div>

          <div style={{ borderTop: `1px solid ${C.hairline}` }} className="pt-1">
            <Toggle on={state?.attendancePublic !== false} label={s.publicTitle} lead={s.publicLead}
              onChange={(v) => toggle("attendancePublic", v)} />
            <Toggle on={state?.staffMail !== false} label={s.mailTitle} lead={s.mailLead}
              onChange={(v) => toggle("staffMail", v)} />
          </div>
        </section>

        {/* ── Who is in ──────────────────────────────────────────────── */}
        <section className="panel p-4 md:p-5">
          <h3 className="display font-bold text-sm mb-3">{fill(s.onShift, { n: present.size })}</h3>
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

        {/* ── Today, with the pictures ───────────────────────────────── */}
        <section className="panel p-4 md:p-5">
          <h3 className="display font-bold text-sm mb-3 flex items-center gap-2">
            <Camera size={14} style={{ color: C.iris }} /> {s.today}
          </h3>

          {today.length === 0 ? (
            <p className="text-xs" style={{ color: C.slate }}>{s.nothingToday}</p>
          ) : (
            <div className="space-y-1.5">
              {today.map((p, i) => {
                const thumb = thumbs[p.id];
                const gone = p.photo && !thumb;
                return (
                  <div key={p.id} className="flex items-center gap-3 px-2 py-2 rounded-lg"
                    style={{ background: "var(--chip-bg)" }}>

                    {/* The picture, or an honest statement of why there isn't
                        one. A blank square would read as "nothing happened". */}
                    {thumb ? (
                      <button type="button" onClick={() => openPhoto(p)}
                        className="shrink-0 rounded-lg overflow-hidden"
                        style={{ width: 44, height: 44, border: `1px solid ${C.hairline}` }}
                        aria-label={fill(s.photoOf, { name: nameOf(p.employeeId) })}>
                        <img src={thumb} alt="" className="w-full h-full object-cover" />
                      </button>
                    ) : (
                      <span className="shrink-0 rounded-lg flex items-center justify-center"
                        style={{ width: 44, height: 44, border: `1px solid ${C.hairline}`, color: C.slate }}
                        title={gone ? s.photoRemoved : s.noPhoto}>
                        {gone ? <ImageOff size={15} /> : <UserCheck size={15} />}
                      </span>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold truncate">{nameOf(p.employeeId)}</div>
                      <div className="text-[11px] flex items-center gap-1.5 flex-wrap" style={{ color: C.slate }}>
                        <span className="flex items-center gap-1"
                          style={{ color: p.kind === "in" ? C.mint : C.slate }}>
                          {p.kind === "in" ? <LogIn size={11} /> : <LogOut size={11} />}
                          {clock(p.at)}
                        </span>
                        {/* Which door it came through. A punch a manager typed
                            and a punch somebody photographed are not the same
                            evidence, and the row should not pretend they are. */}
                        <span>· {p.source === "web" ? s.bySelf : s.byManager}</span>
                        {ranFor(p, i) && <span>· {ranFor(p, i)}</span>}
                        {gone && <span style={{ color: C.amber }}>· {s.photoRemoved}</span>}
                      </div>
                    </div>

                    {thumb && (
                      confirming === p.id ? (
                        <span className="flex items-center gap-1 shrink-0">
                          <button type="button" onClick={() => removePhoto(p.id)} disabled={busy === p.id}
                            className="px-2 py-1 rounded text-[11px] font-bold"
                            style={{ background: C.rose, color: "#fff" }}>
                            {busy === p.id ? <Loader2 size={11} className="animate-spin" /> : s.removeYes}
                          </button>
                          <button type="button" onClick={() => setConfirming("")}
                            className="px-2 py-1 rounded text-[11px]" style={{ color: C.slate }}>
                            {t.common.cancel}
                          </button>
                        </span>
                      ) : (
                        <button type="button" onClick={() => setConfirming(p.id)} title={s.removePhoto}
                          className="p-1.5 rounded shrink-0" style={{ color: C.slate }}>
                          <Trash2 size={14} />
                        </button>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── The roster ─────────────────────────────────────────────── */}
        <section className="panel p-4 md:p-5">
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <h3 className="display font-bold text-sm">{s.roster}</h3>
            <button type="button" onClick={() => setAdding((v) => !v)}
              className="text-xs font-semibold flex items-center gap-1.5" style={{ color: C.iris }}>
              <UserPlus size={13} /> {s.add}
            </button>
          </div>

          {adding && (
            <form className="grid gap-2 mb-3"
              onSubmit={async (e) => {
                e.preventDefault();
                const out = await post("add", draft);
                if (!out) return;
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
              <button type="submit" className="px-4 py-2 rounded-lg text-sm font-bold"
                style={{ background: C.iris, color: C.onPrimary }}>
                {s.addPerson}
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
                      {[e.title, state?.branchNames?.[e.branchId]].filter(Boolean).join(" · ") || s.noTitle}
                    </div>
                  </div>
                  {present.has(e.id) && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded"
                      style={{ background: `color-mix(in srgb, ${C.mint} 16%, transparent)`, color: C.mint }}>
                      {s.inNow}
                    </span>
                  )}
                  {/* For the person who walked out without clocking out. It
                      carries this account's name and no photograph, which is
                      what the row in the day's list will say. */}
                  <button type="button"
                    title={present.has(e.id) ? s.recordOut : s.recordIn}
                    onClick={() => post("punch", { employeeId: e.id, branchId: e.branchId || "" })}
                    className="px-2 py-1 rounded text-[11px] font-semibold"
                    style={{ border: `1px solid ${C.hairline}`, color: C.slate }}>
                    {present.has(e.id) ? s.recordOut : s.recordIn}
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

        {error && (
          <p className="text-xs flex items-center justify-center gap-1.5" style={{ color: C.rose }}>
            <AlertTriangle size={13} /> {error}
          </p>
        )}
      </div>

      {/* The full-size photograph.

          Through a portal for the reason the notification sheet is: the
          screen's own scroll container and the header's backdrop filter both
          create containing blocks, and a fixed overlay inside one of them is
          laid out against that box rather than the viewport. */}
      {viewing && createPortal((
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: C.scrim }} role="presentation"
          onClick={() => setViewing(null)}>
          <div className="w-full max-w-lg rounded-2xl overflow-hidden"
            style={{ background: "var(--panel-solid)", border: `1px solid ${C.hairline}` }}
            onClick={(ev) => ev.stopPropagation()} role="dialog" aria-modal="true">
            <div className="px-4 py-3 flex items-center justify-between gap-3"
              style={{ borderBottom: `1px solid ${C.hairline}` }}>
              <div className="min-w-0">
                <div className="text-sm font-bold truncate">{nameOf(viewing.punch.employeeId)}</div>
                <div className="text-[11px]" style={{ color: C.slate }}>
                  {clock(viewing.punch.at)} · {viewing.punch.kind === "in" ? s.inNow : s.outNow}
                </div>
              </div>
              <button type="button" onClick={() => setViewing(null)} aria-label={t.common.close}
                className="p-2 -m-2 rounded-lg shrink-0" style={{ color: C.slate }}>
                <X size={18} />
              </button>
            </div>

            <div className="flex items-center justify-center" style={{ minHeight: 200, background: C.bone }}>
              {viewing.loading ? (
                <Loader2 size={20} className="animate-spin" style={{ color: C.slate }} />
              ) : viewing.url ? (
                <img src={viewing.url} alt="" className="w-full max-h-[62vh] object-contain" />
              ) : (
                <p className="text-xs p-8 text-center" style={{ color: C.slate }}>{s.photoGone}</p>
              )}
            </div>

            {viewing.url && (
              <div className="px-4 py-3 flex justify-end" style={{ borderTop: `1px solid ${C.hairline}` }}>
                {confirming === viewing.id ? (
                  <span className="flex items-center gap-2">
                    <span className="text-[11px]" style={{ color: C.slate }}>{s.removeSure}</span>
                    <button type="button" onClick={() => removePhoto(viewing.id)} disabled={busy === viewing.id}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold"
                      style={{ background: C.rose, color: "#fff" }}>
                      {busy === viewing.id ? <Loader2 size={12} className="animate-spin" /> : s.removeYes}
                    </button>
                    <button type="button" onClick={() => setConfirming("")}
                      className="px-2 py-1.5 text-xs" style={{ color: C.slate }}>
                      {t.common.cancel}
                    </button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirming(viewing.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                    style={{ color: C.rose }}>
                    <Trash2 size={13} /> {s.removePhoto}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      ), document.body)}
    </div>
  );
}
