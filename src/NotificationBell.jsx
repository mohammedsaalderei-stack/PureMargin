import { useState, useEffect, useRef, useMemo } from "react";
import { Bell, Check, X, MessageCircleQuestion } from "lucide-react";
import { useC } from "./theme.jsx";
import { useLang, fill } from "./i18n.jsx";
import { buildNotices, pastEod, isWeekEnd } from "./notices.js";

/* The bell.

   Reads the switches in Settings that until now saved and were never read.
   Notices are derived from figures already on screen rather than fetched, so
   the bell cannot disagree with the dashboard beneath it.

   "Seen" is the newest timestamp acknowledged, kept in the browser. Not on the
   server, because a notice is a reading of the current numbers rather than an
   event that happened: sign in on a different device and the state of the
   business is the same, so the same things are worth saying. A read-receipt
   synced across devices would be tracking something this feature does not
   actually have — a history. */

const SEEN_KEY = "puremargin_notices_seen";
const TONE = { good: "cyan", warn: "rose", info: "iris" };

export default function NotificationBell({ data, onAsk }) {
  const C = useC();
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(0);
  const box = useRef(null);

  useEffect(() => {
    try { setSeen(Number(localStorage.getItem(SEEN_KEY)) || 0); } catch { /* private mode */ }
  }, []);

  /* Read fresh each render rather than held in state: Settings writes these
     on the same page, and a copy taken at mount would go stale the moment
     somebody flipped a switch. */
  const { prefs, dailyTarget, eodTime } = useMemo(() => {
    try {
      return {
        prefs: JSON.parse(localStorage.getItem("sufra_alerts") || "{}"),
        dailyTarget: localStorage.getItem("sufra_target") || 0,
        eodTime: localStorage.getItem("sufra_eod") || "",
      };
    } catch {
      return { prefs: {}, dailyTarget: 0, eodTime: "" };
    }
  }, [open, data]);

  const notices = useMemo(() => buildNotices(data, prefs, {
    t, fill, dailyTarget,
    pastEod: pastEod(eodTime),
    isWeekEnd: isWeekEnd(),
  }), [data, prefs, dailyTarget, eodTime, t]);

  const unseen = notices.filter((n) => n.at > seen).length;

  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const markSeen = () => {
    const now = Date.now();
    setSeen(now);
    try { localStorage.setItem(SEEN_KEY, String(now)); } catch { /* private mode */ }
  };

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); if (!open) markSeen(); }}
        className="relative p-2.5 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center"
        style={{ color: open ? C.iris : C.slate }}
        aria-label={t.notices.title}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Bell size={19} strokeWidth={open ? 2.3 : 1.8} />
        {unseen > 0 && (
          <span
            className="absolute top-1.5 rounded-full text-[10px] font-bold flex items-center justify-center"
            style={{
              insetInlineEnd: 6, minWidth: 16, height: 16, padding: "0 4px",
              background: C.rose, color: "#fff",
            }}
          >
            {unseen > 9 ? "9+" : unseen}
          </span>
        )}
      </button>

      {open && (
        /* A dialog rather than a dropdown.

           A panel hanging off a button in a sidebar had nowhere to go on a
           phone: it either ran off the edge or was squeezed to a column too
           narrow to read a sentence in. A centred sheet is the same component
           at both sizes, and it gives each notice room for the one thing that
           makes it useful — a way to go and ask about it. */
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
          style={{ background: C.scrim }}
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            className="w-full sm:max-w-md max-h-[85vh] flex flex-col rounded-t-2xl sm:rounded-2xl overflow-hidden sheet-in"
            style={{ background: "var(--panel-solid)", border: `1px solid ${C.hairline}` }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={t.notices.title}
          >
            <div className="px-5 py-4 flex items-start justify-between gap-3"
              style={{ borderBottom: `1px solid ${C.hairline}` }}>
              <div>
                <div className="text-base font-bold">{t.notices.title}</div>
                <div className="text-xs mt-0.5" style={{ color: C.slate }}>{t.notices.lead}</div>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label={t.common.close}
                className="p-2 -m-2 rounded-lg shrink-0" style={{ color: C.slate }}>
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {notices.length === 0 && (
                <p className="px-5 py-12 text-sm text-center" style={{ color: C.slate }}>
                  {t.notices.empty}
                </p>
              )}
              {notices.map((n) => (
                <div key={n.id} className="px-5 py-4"
                  style={{ borderBottom: `1px solid ${C.hairline}` }}>
                  <div className="flex gap-3">
                    <span className="mt-1.5 shrink-0 rounded-full"
                      style={{ width: 8, height: 8, background: C[TONE[n.tone]] || C.iris }} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold">{n.title}</div>
                      <div className="text-xs mt-1" style={{ color: C.slate }}>{n.body}</div>

                      {onAsk && (
                        <button
                          type="button"
                          onClick={() => { setOpen(false); onAsk(n.ask || `${n.title}. ${n.body}`); }}
                          className="mt-2.5 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold"
                          style={{ background: C.irisWash, color: C.iris }}
                        >
                          <MessageCircleQuestion size={13} />
                          {t.notices.ask}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="px-5 py-3 flex items-center gap-1.5 text-[11px] shrink-0"
              style={{ color: C.slate, borderTop: `1px solid ${C.hairline}` }}>
              <Check size={12} /> {t.notices.settingsHint}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
