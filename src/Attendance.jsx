import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft, Camera, Check, Loader2, LogIn, LogOut,
  MapPin, Search, Store, User, AlertTriangle, RefreshCw,
} from "lucide-react";
import { useC } from "./theme.jsx";
import BrandMark from "./BrandMark.jsx";
import { useLang, fill, localeFor } from "./i18n.jsx";
import LanguagePicker from "./LanguagePicker.jsx";
import { prepareShot, ShotError } from "./attendance/shot.js";

/* Clocking in, from the front door of the website.

   ── Who this is for, and what that changes ───────────────────────────────

   Everything else in this product is used by somebody sitting down with a
   business to run. This is used by somebody standing outside a restaurant at
   six in the morning, on their own phone, probably in the rain, in the fourth
   language they speak. It is the only screen here that a person with no
   account ever sees, and very likely the only one they will ever use.

   So it is one question at a time, each one large, with a way back. No form
   with five fields, no scrolling to find the button, nothing that needs a
   second hand. The steps are: which restaurant, which branch, who are you,
   take a picture. The branch step disappears entirely when there is only one,
   because a person who works at the only branch should never be asked which
   branch.

   ── The picture is not optional, and that is the whole design ────────────

   There is no "skip". A tap on a name with nothing attached is worth nothing —
   anybody could make one, and the version of this that used a code had the
   same hole with an extra step. The photograph does not prove who is holding
   the phone. What it does is put something in front of the owner that they can
   look at and judge, next to the name and the time.

   ── Nothing is remembered but the store ──────────────────────────────────

   The chosen restaurant and branch are kept in this browser, so the second
   morning is two taps rather than four. The person is not: `localStorage` on a
   shared phone would hand the next user somebody else's name pre-selected,
   already one tap from a shift they did not work. */

const REMEMBER = "puremargin_clockin_store";
const DEBOUNCE_MS = 250;

export default function Attendance({ onBack }) {
  const C = useC();
  const { t, lang } = useLang();
  const s = t.attendance;

  /* "store" → "branch" → "who" → "photo" → "done" */
  const [step, setStep] = useState("store");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [store, setStore] = useState(null);
  const [branch, setBranch] = useState(null);
  const [people, setPeople] = useState(null);
  const [person, setPerson] = useState(null);
  const [preview, setPreview] = useState(null);
  const [shot, setShot] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);

  const camera = useRef(null);
  const timer = useRef(null);

  /* Last time's restaurant, offered rather than assumed: it is shown as the
     chosen store with the branch step still ahead, so somebody who moved
     branches or covers two of them is not silently sent to the wrong one. */
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(REMEMBER) || "null");
      if (saved?.id && saved?.name) {
        setStore(saved);
        setStep(saved.branches?.length > 1 ? "branch" : "who");
        if (!(saved.branches?.length > 1)) setBranch(saved.branches?.[0] || null);
      }
    } catch { /* private mode, or nothing saved — start at the search */ }
  }, []);

  /* Search as they type, once they stop.

     A request per keystroke on a public endpoint is both rude and slower than
     waiting a quarter second: on a phone keyboard the answers to "al" and
     "al " arrive out of order and the list flickers between them. */
  useEffect(() => {
    clearTimeout(timer.current);
    const q = query.trim();
    if (q.length < 2) { setResults([]); setSearching(false); return undefined; }

    setSearching(true);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/attendance?what=stores&q=${encodeURIComponent(q)}`);
        const json = await res.json();
        setResults(json.stores || []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer.current);
  }, [query]);

  const loadPeople = useCallback(async (storeId, branchId) => {
    setPeople(null);
    setError("");
    try {
      const qs = new URLSearchParams({ what: "people", store: storeId });
      if (branchId) qs.set("branch", branchId);
      const res = await fetch(`/api/attendance?${qs}`);
      const json = await res.json();
      if (!res.ok) { setError(s.errStore); setPeople([]); return; }
      setPeople(json.people || []);
    } catch {
      setError(s.errOffline);
      setPeople([]);
    }
  }, [s]);

  useEffect(() => {
    if (step === "who" && store) loadPeople(store.id, branch?.id || "");
  }, [step, store, branch, loadPeople]);

  function chooseStore(next) {
    setStore(next);
    setBranch(null);
    setPerson(null);
    try { localStorage.setItem(REMEMBER, JSON.stringify(next)); } catch { /* private mode */ }
    if (next.branches?.length > 1) setStep("branch");
    else { setBranch(next.branches?.[0] || null); setStep("who"); }
  }

  async function takePhoto(file) {
    setError("");
    setBusy(true);
    try {
      const out = await prepareShot(file);
      setShot(out);
      setPreview(out.thumb);
    } catch (err) {
      setShot(null);
      setPreview(null);
      setError(err instanceof ShotError && err.code === "notphoto" ? s.errNotPhoto : s.errPhoto);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!shot || !person || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/attendance?what=punch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store: store.id,
          branch: branch?.id || "",
          employeeId: person.id,
          photo: shot.full,
          thumb: shot.thumb,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          res.status === 429 ? s.errBusy
            : json.error === "noperson" ? s.errPerson
              : String(json.error || "").startsWith("photo") ? s.errPhoto
                : s.errServer,
        );
        return;
      }
      setDone(json);
      setStep("done");
    } catch {
      setError(s.errOffline);
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    setStep(store?.branches?.length > 1 ? "branch" : "who");
    setPerson(null);
    setShot(null);
    setPreview(null);
    setDone(null);
    setError("");
  }

  const back = () => {
    setError("");
    if (step === "photo") { setStep("who"); setShot(null); setPreview(null); }
    else if (step === "who") {
      if (store?.branches?.length > 1) setStep("branch");
      else { setStore(null); setStep("store"); }
    } else if (step === "branch") { setStore(null); setStep("store"); }
    else onBack?.();
  };

  const clock = (ms) => {
    try {
      return new Date(ms).toLocaleTimeString(localeFor(lang), { hour: "2-digit", minute: "2-digit" })
        .replace(/[‎‏‪-‮⁦-⁩]/g, "");
    } catch { return ""; }
  };

  /* Big enough to hit with a thumb, every one of them. 56px is the floor an
     interface used outdoors in a hurry has to clear. */
  const rowStyle = {
    background: C.surface,
    border: `1px solid ${C.hairline}`,
    color: C.ink,
    minHeight: 56,
  };

  return (
    <div className="min-h-full flex flex-col" style={{ background: C.bone, color: C.ink }}>
      <header className="sticky top-0 z-20 px-4 py-3 flex items-center gap-3"
        style={{ background: C.bone, borderBottom: `1px solid ${C.hairline}` }}>
        <button type="button" onClick={back} aria-label={t.common.back}
          className="p-2 -m-2 rounded-lg shrink-0" style={{ color: C.slate }}>
          {/* `flip-rtl`, which every other back arrow in the app uses. Writing
              this as a Tailwind `rtl:` variant looks equivalent and is not —
              nothing configures that variant here, so the class does nothing
              and the arrow points left on an Arabic page. */}
          <ArrowLeft size={20} className="flip-rtl" />
        </button>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <BrandMark size={26} />
          <span className="font-bold truncate">{s.title}</span>
        </div>
        <LanguagePicker compact />
      </header>

      <main className="flex-1 w-full max-w-md mx-auto px-4 py-5 pb-10">
        {/* Where they are in the four steps. Not a decoration: somebody who
            looks up from their phone needs to find their place again. */}
        {step !== "done" && (
          <ol className="flex items-center gap-1.5 mb-5" aria-hidden="true">
            {["store", "branch", "who", "photo"]
              .filter((k) => k !== "branch" || (store?.branches?.length || 0) > 1)
              .map((k) => (
                <li key={k} className="h-1 flex-1 rounded-full"
                  style={{ background: k === step ? C.iris : C.hairline }} />
              ))}
          </ol>
        )}

        {step === "store" && (
          <section>
            <h1 className="display font-bold text-xl mb-1">{s.whereTitle}</h1>
            <p className="text-sm mb-4" style={{ color: C.slate }}>{s.whereLead}</p>

            <div className="relative mb-3">
              <Search size={16} className="absolute top-1/2 -translate-y-1/2 start-3.5" style={{ color: C.slate }} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={s.searchPlaceholder}
                /* No autofocus. On a phone it throws the keyboard up over the
                   results the moment the page opens, and somebody returning to
                   a remembered store never wanted to type at all. */
                autoComplete="off"
                autoCorrect="off"
                spellCheck="false"
                className="w-full ps-10 pe-3 py-3.5 rounded-xl text-base"
                style={{ background: C.surface, border: `1px solid ${C.hairline}`, color: C.ink }}
              />
            </div>

            {query.trim().length > 0 && query.trim().length < 2 && (
              <p className="text-xs px-1" style={{ color: C.slate }}>{s.keepTyping}</p>
            )}

            {searching && (
              <p className="text-xs px-1 flex items-center gap-2" style={{ color: C.slate }}>
                <Loader2 size={13} className="animate-spin" /> {s.searching}
              </p>
            )}

            <div className="space-y-2">
              {results.map((r) => (
                <button key={r.id} type="button" onClick={() => chooseStore(r)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-start"
                  style={rowStyle}>
                  <Store size={17} style={{ color: C.iris }} className="shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold truncate">{r.name}</span>
                    {r.branches?.length > 1 && (
                      <span className="block text-[11px]" style={{ color: C.slate }}>
                        {fill(s.nBranches, { n: r.branches.length })}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>

            {!searching && query.trim().length >= 2 && results.length === 0 && (
              <div className="rounded-xl p-4 text-center text-xs" style={{ color: C.slate }}>
                {s.noStores}
              </div>
            )}
          </section>
        )}

        {step === "branch" && (
          <section>
            <h1 className="display font-bold text-xl mb-1">{s.branchTitle}</h1>
            <p className="text-sm mb-4" style={{ color: C.slate }}>{store?.name}</p>
            <div className="space-y-2">
              {(store?.branches || []).map((b) => (
                <button key={b.id} type="button"
                  onClick={() => { setBranch(b); setStep("who"); }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-start"
                  style={rowStyle}>
                  <MapPin size={17} style={{ color: C.iris }} className="shrink-0" />
                  <span className="text-sm font-semibold truncate">{b.name || s.unnamedBranch}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {step === "who" && (
          <section>
            <h1 className="display font-bold text-xl mb-1">{s.whoTitle}</h1>
            <p className="text-sm mb-4" style={{ color: C.slate }}>
              {[store?.name, branch?.name].filter(Boolean).join(" · ")}
            </p>

            {people === null ? (
              <p className="text-xs flex items-center gap-2" style={{ color: C.slate }}>
                <Loader2 size={13} className="animate-spin" /> {s.loading}
              </p>
            ) : people.length === 0 ? (
              <div className="rounded-xl p-4 text-xs" style={{ color: C.slate, border: `1px solid ${C.hairline}` }}>
                {s.noPeople}
              </div>
            ) : (
              <div className="space-y-2">
                {people.map((p) => (
                  <button key={p.id} type="button"
                    onClick={() => { setPerson(p); setStep("photo"); }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-start"
                    style={rowStyle}>
                    <User size={17} style={{ color: C.iris }} className="shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold truncate">{p.name}</span>
                      {p.title && (
                        <span className="block text-[11px] truncate" style={{ color: C.slate }}>{p.title}</span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {step === "photo" && (
          <section>
            <h1 className="display font-bold text-xl mb-1">{s.photoTitle}</h1>
            <p className="text-sm mb-4" style={{ color: C.slate }}>{s.photoLead}</p>

            {/* `capture` is deliberate here, and deliberately absent in
                `ai/PhotoScan.jsx` — the comment there explains that it strips
                Photo Library and Files out of the sheet, which broke sending a
                PDF a supplier had emailed.

                That is exactly what is wanted on this screen. The point of the
                picture is that it was taken now, at the place; an image chosen
                from the camera roll is a photograph of somewhere the person may
                have been last week. Removing the library is the feature. */}
            <input
              ref={camera}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) takePhoto(file);
              }}
            />

            <button type="button" onClick={() => camera.current?.click()} disabled={busy}
              className="w-full rounded-2xl flex flex-col items-center justify-center gap-2 py-8 mb-3 disabled:opacity-50"
              style={{
                background: preview ? "transparent" : C.irisWash,
                border: `1.5px dashed ${preview ? C.hairline : C.iris}`,
                color: C.iris,
                minHeight: 180,
              }}>
              {busy ? (
                <Loader2 size={26} className="animate-spin" />
              ) : preview ? (
                <>
                  <img src={preview} alt={s.photoAlt}
                    className="rounded-xl object-cover" style={{ maxHeight: 190 }} />
                  <span className="text-xs font-semibold flex items-center gap-1.5">
                    <RefreshCw size={12} /> {s.retake}
                  </span>
                </>
              ) : (
                <>
                  <Camera size={30} />
                  <span className="text-sm font-bold">{s.takePhoto}</span>
                  <span className="text-[11px] px-6 text-center" style={{ color: C.slate }}>
                    {s.photoHint}
                  </span>
                </>
              )}
            </button>

            <div className="rounded-xl px-4 py-3 mb-3 text-xs"
              style={{ background: C.surface, border: `1px solid ${C.hairline}`, color: C.slate }}>
              <span className="font-semibold" style={{ color: C.ink }}>{person?.name}</span>
              {" · "}
              {[store?.name, branch?.name].filter(Boolean).join(" · ")}
            </div>

            <button type="button" onClick={submit} disabled={!shot || busy}
              className="w-full flex items-center justify-center gap-2 px-4 py-4 rounded-xl text-base font-bold disabled:opacity-40"
              style={{ background: C.iris, color: C.onPrimary }}>
              {busy ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
              {s.confirm}
            </button>
          </section>
        )}

        {step === "done" && done && (
          <section className="text-center pt-6">
            <div className="mx-auto mb-4 rounded-full flex items-center justify-center"
              style={{
                width: 76, height: 76,
                background: `color-mix(in srgb, ${done.kind === "in" ? C.mint : C.iris} 14%, transparent)`,
                color: done.kind === "in" ? C.mint : C.iris,
              }}>
              {done.kind === "in" ? <LogIn size={32} /> : <LogOut size={32} />}
            </div>

            <h1 className="display font-bold text-2xl mb-1">
              {fill(done.kind === "in" ? s.welcomed : s.farewelled, { name: done.name })}
            </h1>
            <p className="text-sm" style={{ color: C.slate }}>
              {fill(done.kind === "in" ? s.clockedInAt : s.clockedOutAt, { time: clock(done.at) })}
            </p>
            {[store?.name, done.branchName].filter(Boolean).length > 0 && (
              <p className="text-xs mt-1" style={{ color: C.slate }}>
                {[store?.name, done.branchName].filter(Boolean).join(" · ")}
              </p>
            )}

            {/* A second tap moments later is the same arrival, not a departure.
                Saying so is kinder than a screen that looks like it failed. */}
            {done.repeat && (
              <p className="text-xs mt-3 px-6" style={{ color: C.amber }}>{s.already}</p>
            )}

            <p className="text-xs mt-5 px-4" style={{ color: C.slate }}>{s.ownerTold}</p>

            <button type="button" onClick={startOver}
              className="mt-6 w-full px-4 py-3.5 rounded-xl text-sm font-bold"
              style={{ background: C.surface, border: `1px solid ${C.hairline}`, color: C.ink }}>
              {s.somebodyElse}
            </button>
          </section>
        )}

        {error && (
          <p className="text-xs mt-4 flex items-start justify-center gap-1.5 text-center"
            style={{ color: C.rose }}>
            <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {error}
          </p>
        )}
      </main>
    </div>
  );
}
