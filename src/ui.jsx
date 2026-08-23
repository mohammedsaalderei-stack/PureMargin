import { useC } from "./theme.jsx";

/* Glassmorphism UI primitives — one definition, used everywhere. */

export function GlassCard({ children, className = "", style = {}, interactive = false, ...rest }) {
  return (
    <div
      className={`glass-card ${interactive ? "glass-interactive" : ""} ${className}`}
      style={style}
      {...rest}
    >
      {children}
    </div>
  );
}

export function GradientButton({ children, className = "", style = {}, ...rest }) {
  return (
    <button
      className={`gpill gpill-primary ${className}`}
      style={{ fontWeight: 600, ...style }}
      {...rest}
    >
      {children}
    </button>
  );
}

export function GhostButton({ children, className = "", style = {}, ...rest }) {
  return (
    <button
      className={`gpill gpill-ghost ${className}`}
      style={{ fontWeight: 600, ...style }}
      {...rest}
    >
      {children}
    </button>
  );
}

export function SectionLabel({ children, className = "", style = {} }) {
  const C = useC();
  return (
    <span
      className={className}
      style={{
        fontFamily: "'Space Grotesk', 'Tajawal', system-ui, sans-serif",
        fontSize: "0.7rem",
        fontWeight: 600,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: C.slate,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function TrendIndicator({ value, size = 13 }) {
  if (value === null || value === undefined) return null;
  const up = value >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-semibold ${up ? "trend-up" : "trend-down"}`}
      dir="ltr"
    >
      {up ? "▲" : "▼"} {Math.abs(value).toFixed(1)}%
    </span>
  );
}

/* Ambient background orbs — render once at the app root */
export function AmbientBackground() {
  return (
    <div className="glass-aura" aria-hidden="true">
      <span className="orb orb-1" />
      <span className="orb orb-2" />
    </div>
  );
}
