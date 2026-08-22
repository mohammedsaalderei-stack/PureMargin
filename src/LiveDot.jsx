import { useEffect, useState } from "react";
import { useC } from "./theme.jsx";
import { useLang, fill } from "./i18n.jsx";

/* "Updated 12 seconds ago", ticking on its own.

   A dashboard that claims to be live should show its own age; otherwise a
   frozen feed and a quiet evening look identical. The dot pulses while a
   fetch is in flight so a refresh is visible even when no number changes. */
export default function LiveDot({ fetchedAt, refreshing }) {
  const C = useC();
  const { t } = useLang();
  const [, tick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, []);

  if (!fetchedAt) return null;

  const seconds = Math.max(0, Math.round((Date.now() - fetchedAt) / 1000));
  const label =
    seconds < 10
      ? t.live.justNow
      : seconds < 60
      ? fill(t.live.secondsAgo, { n: seconds })
      : fill(t.live.minutesAgo, { n: Math.round(seconds / 60) });

  // Past a couple of minutes something is wrong with the polling.
  const stale = seconds > 150;

  return (
    <span className="inline-flex items-center gap-1.5 micro" style={{ color: C.slate }}>
      <span
        className="rounded-full"
        style={{
          width: 6,
          height: 6,
          background: stale ? C.rose : C.cyan,
          opacity: refreshing ? 1 : 0.55,
          transition: "opacity .3s ease",
          boxShadow: `0 0 10px ${stale ? C.rose : C.cyan}`,
          animation: refreshing ? "live-pulse 1s ease-in-out infinite" : "none",
        }}
      />
      {label}
    </span>
  );
}
