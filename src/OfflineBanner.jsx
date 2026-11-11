/* A strip across the top when the app is showing what it saved.

   Said plainly and once: these are the figures from a given time, changes
   need a connection, and the register is still selling. A screen of saved
   figures that looks live is worse than an error — somebody acts on it. */

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { useC } from "./theme.jsx";
import { useLang, fill, localeFor } from "./i18n.jsx";
import { offlineState, subscribeOffline } from "./offline.js";

export function useOffline() {
  const [state, setState] = useState(offlineState());
  useEffect(() => subscribeOffline(setState), []);
  return state;
}

export default function OfflineBanner() {
  const C = useC();
  const { t, lang } = useLang();
  const { offline, savedAt } = useOffline();
  if (!offline) return null;
  let when = "";
  if (savedAt) {
    try {
      const d = new Date(savedAt);
      const sameDay = d.toDateString() === new Date().toDateString();
      when = d.toLocaleString(localeFor(lang), sameDay ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    } catch { /* shown without a time */ }
  }
  return (
    <div role="status" className="shrink-0 flex items-center justify-center gap-2 px-3 py-1.5 text-[11.5px] font-semibold text-center"
      style={{ background: "rgba(251,191,36,0.14)", color: C.amber, borderBottom: `1px solid ${C.hairline}` }}>
      <WifiOff size={13} className="shrink-0" />
      <span>{when ? fill(t.pos.offline.saved, { time: when }) : t.pos.offline.none} {t.pos.offline.changes}</span>
    </div>
  );
}
