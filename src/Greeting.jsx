import { useEffect, useState } from "react";
import { useC } from "./theme.jsx";
import { useLang, localeFor } from "./i18n.jsx";

/* "Good evening, Mohammed" — on the device's own clock, and correct all
   day rather than only at sign-in.

   It re-checks every minute, so someone who leaves the dashboard open on a
   counter through a shift doesn't still see "good morning" at nine at
   night. Cheap: one comparison a minute, and state only changes three
   times a day. */
function partOfDay(t) {
  const h = new Date().getHours();
  if (h < 12) return t.overview.morning;
  if (h < 17) return t.overview.afternoon;
  return t.overview.evening;
}

export default function Greeting({ user, business, compact = false }) {
  const C = useC();
  const { t, lang } = useLang();
  const [greeting, setGreeting] = useState(() => partOfDay(t));

  useEffect(() => {
    const id = setInterval(() => setGreeting(partOfDay(t)), 60 * 1000);
    return () => clearInterval(id);
  }, [t]);

  const name = business || user || "";

  if (compact) {
    return (
      <span className="text-xs truncate max-w-[42vw]" style={{ color: C.slate }}>
        {greeting}
      </span>
    );
  }

  return (
    <div>
      <div className="text-sm font-semibold leading-tight">{greeting}</div>
      {name && (
        <div className="text-xs truncate mt-0.5" style={{ color: C.slate }}>
          {name}
        </div>
      )}
      <div className="text-[11px] mt-1" style={{ color: C.slate }} dir="ltr">
        {new Date().toLocaleDateString(localeFor(lang), {
          weekday: "long",
          day: "numeric",
          month: "short",
        }).replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")}
      </div>
    </div>
  );
}
