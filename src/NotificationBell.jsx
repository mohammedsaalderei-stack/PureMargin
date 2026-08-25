import { useState, useEffect, useRef, useMemo } from "react";
import { Bell, Check } from "lucide-react";
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

export default function NotificationBell({ data }) {
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
        <div
          className="absolute z-50 mt-1 w-[19rem] max-w-[85vw] rounded-2xl overflow-hidden shadow-xl"
          style={{
            insetInlineEnd: 0,
            background: "var(--panel-solid)",
            border: `1px solid ${C.hairline}`,
            backdropFilter: "blur(20px)",
          }}
          role="region"
          aria-label={t.notices.title}
        >
          <div className="px-4 py-3" style={{ borderBottom: `1px solid ${C.hairline}` }}>
            <div className="text-sm font-bold">{t.notices.title}</div>
            <div className="text-[11px]" style={{ color: C.slate }}>{t.notices.lead}</div>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {notices.length === 0 && (
              <p className="px-4 py-8 text-sm text-center" style={{ color: C.slate }}>
                {t.notices.empty}
              </p>
            )}
            {notices.map((n) => (
              <div key={n.id} className="px-4 py-3 flex gap-3"
                style={{ borderBottom: `1px solid ${C.hairline}` }}>
                <span className="mt-1.5 shrink-0 rounded-full"
                  style={{ width: 7, height: 7, background: C[TONE[n.tone]] || C.iris }} />
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{n.title}</div>
                  <div className="text-xs mt-0.5" style={{ color: C.slate }}>{n.body}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="px-4 py-2.5 flex items-center gap-1.5 text-[11px]" style={{ color: C.slate }}>
            <Check size={12} /> {t.notices.settingsHint}
          </div>
        </div>
      )}
    </div>
  );
}
