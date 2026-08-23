import { createContext, useContext, useEffect, useMemo, useState } from "react";

/* Two palettes, one shape.
   Colours are resolved in JavaScript rather than through CSS variables
   because Recharts writes them as SVG presentation attributes, and
   `fill="var(--iris)"` does not resolve there. The CSS variables in
   index.css still exist and are kept in step for anything styled in CSS. */

export const LIGHT = {
  ink: "#150E24",
  slate: "#6B6478",
  hairline: "#E2D9F5",
  bone: "#F7F4FD",
  surface: "#FFFFFF",
  raised: "#FFFFFF",
  iris: "#7E22CE",
  irisDeep: "#581C87",
  irisWash: "#F5ECFE",
  lilac: "#9333EA",
  lilacWash: "#F1E6FD",
  neon: "#A21CAF",
  cyan: "#0E7490",
  cyanWash: "#E0F4F8",
  rose: "#C4426E",
  glow: "rgba(147,51,234,.16)",
  grid: "rgba(147,51,234,.06)",
  edge: "rgba(147,51,234,.24)",
  onPrimary: "#FFFFFF",
  onDark: "#FFFFFF",
  panel: "#12091F",
  panelText: "#F0E8FF",
  panelMuted: "rgba(240,232,255,.62)",
  scrim: "rgba(21,14,36,.45)",
};

/* Dark is not the light palette inverted. Surfaces lift with lightness
   rather than shadow, the primary is lightened so it stays legible on a
   dark ground, and washes become low-alpha tints instead of pale solids. */
export const DARK = {
  ink: "#F0E8FF",
  slate: "#9180B8",
  hairline: "#1E1440",
  bone: "#05030F",
  surface: "#0A0818",
  raised: "#0F0C22",
  iris: "#A855F7",
  irisDeep: "#C084FC",
  irisWash: "rgba(168,85,247,.14)",
  lilac: "#C084FC",
  lilacWash: "rgba(192,132,252,.12)",
  neon: "#D946EF",
  cyan: "#22D3EE",
  cyanWash: "rgba(34,211,238,.11)",
  rose: "#FB5E7E",
  glow: "rgba(147,51,234,.4)",
  grid: "rgba(147,51,234,.07)",
  edge: "rgba(147,51,234,.35)",
  onDark: "#FFFFFF",
  onPrimary: "#0A0612",
  panel: "#07051A",
  panelText: "#F0E8FF",
  panelMuted: "rgba(240,232,255,.6)",
  scrim: "rgba(2,1,10,.85)",
};

const ThemeContext = createContext(null);

const systemPrefersDark = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState(() => {
    try {
      const saved = localStorage.getItem("sufra_theme");
      if (["light", "dark", "system"].includes(saved)) return saved;
    } catch {
      /* storage unavailable */
    }
    /* Dark-first. The interface is designed as a lit panel; light mode is
       the accommodation, not the default. */
    return "dark";
  });

  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = (e) => setSystemDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const dark = mode === "dark" || (mode === "system" && systemDark);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? DARK.bone : LIGHT.bone);
    try {
      localStorage.setItem("sufra_theme", mode);
    } catch {
      /* not fatal */
    }
  }, [dark, mode]);

  const value = useMemo(
    () => ({ C: dark ? DARK : LIGHT, dark, mode, setMode }),
    [dark, mode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}

/* The common case: a component just wants the palette. */
export function useC() {
  return useTheme().C;
}

export const compact = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + "K";
  return String(Math.round(v));
};
