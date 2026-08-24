import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "./theme.jsx";
import { useLang } from "./i18n.jsx";

const MODES = [
  { id: "light", icon: Sun },
  { id: "dark", icon: Moon },
  { id: "system", icon: Monitor },
];

/* Three states, not two. "System" is the default and matters here: someone
   whose phone flips to dark at sunset expects the app to follow. */
export default function ThemeToggle({ compact = false }) {
  const { C, mode, setMode } = useTheme();
  const { t } = useLang();

  if (compact) {
    const next = mode === "light" ? "dark" : mode === "dark" ? "system" : "light";
    const Icon = MODES.find((m) => m.id === mode).icon;
    return (
      <button
        onClick={() => setMode(next)}
        className="p-1.5 rounded-lg"
        style={{ color: C.slate }}
        aria-label={t.theme.label}
        title={t.theme[mode]}
      >
        <Icon size={17} />
      </button>
    );
  }

  return (
    <div
      className="flex rounded-lg p-0.5 gap-0.5"
      style={{ background: C.bone, border: `1px solid ${C.hairline}` }}
      role="radiogroup"
      aria-label={t.theme.label}
    >
      {MODES.map(({ id, icon: Icon }) => {
        const on = mode === id;
        return (
          <button
            key={id}
            onClick={() => setMode(id)}
            role="radio"
            aria-checked={on}
            title={t.theme[id]}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-semibold transition-colors"
            style={{
              background: on ? C.surface : "transparent",
              color: on ? C.iris : C.slate,
              boxShadow: on ? "0 1px 3px rgba(0,0,0,.08)" : "none",
            }}
          >
            <Icon size={13} />
            {t.theme[id]}
          </button>
        );
      })}
    </div>
  );
}
