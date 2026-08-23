import { createContext, useContext, useEffect, useMemo, useState } from "react";

/* Two palettes, one shape — glassmorphism dark.
   Colours resolved in JS because Recharts writes them as SVG attributes. */

export const LIGHT = {
  ink: "#1A1530",
  slate: "#6B6580",
  hairline: "rgba(139,92,246,0.12)",
  bone: "#F5F3FC",
  surface: "#FFFFFF",
  raised: "#FFFFFF",
  iris: "#7C3AED",
  irisDeep: "#6D28D9",
  irisWash: "rgba(124,58,237,0.08)",
  lilac: "#8B5CF6",
  lilacWash: "rgba(139,92,246,0.06)",
  neon: "#0891B2",
  cyan: "#0891B2",
  cyanWash: "rgba(8,145,178,0.08)",
  rose: "#E11D48",
  glow: "rgba(124,58,237,0.12)",
  grid: "rgba(124,58,237,0.04)",
  edge: "rgba(124,58,237,0.15)",
  onPrimary: "#FFFFFF",
  onDark: "#FFFFFF",
  panel: "#1A1530",
  panelText: "#F5F3FC",
  panelMuted: "rgba(245,243,252,0.6)",
  scrim: "rgba(26,21,48,0.40)",
};

export const DARK = {
  ink: "#E8E6F0",
  slate: "#8B87A8",
  hairline: "rgba(255,255,255,0.08)",
  bone: "#0B0815",
  surface: "#131028",
  raised: "#1A1530",
  iris: "#8B5CF6",
  irisDeep: "#A78BFA",
  irisWash: "rgba(139,92,246,0.12)",
  lilac: "#A78BFA",
  lilacWash: "rgba(167,139,250,0.10)",
  neon: "#06B6D4",
  cyan: "#06B6D4",
  cyanWash: "rgba(6,182,212,0.10)",
  rose: "#F43F5E",
  glow: "rgba(139,92,246,0.25)",
  grid: "rgba(139,92,246,0.04)",
  edge: "rgba(139,92,246,0.20)",
  onPrimary: "#FFFFFF",
  onDark: "#FFFFFF",
  panel: "#0F0C1D",
  panelText: "#E8E6F0",
  panelMuted: "rgba(232,230,240,0.6)",
  scrim: "rgba(5,3,15,0.80)",
};

const ThemeContext = createContext(null);

const systemPrefersDark = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState(() => {
    try {
      const saved = localStorage.getItem("sufra_theme");
      if (["light", "dark", "system"].includes(saved)) return saved;
    } catch { /* */ }
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
    try { localStorage.setItem("sufra_theme", mode); } catch { /* */ }
  }, [dark, mode]);

  const value = useMemo(() => ({ C: dark ? DARK : LIGHT, dark, mode, setMode }), [dark, mode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}

export function useC() { return useTheme().C; }

export const compact = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + "K";
  return String(Math.round(v));
};
