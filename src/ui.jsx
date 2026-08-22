import { useC } from "./theme.jsx";

/* Primitives lifted from the redesign export, kept to its exact values.

   These wrap what were loose Tailwind classes scattered across screens, so
   the design has one definition rather than twelve near-copies that drift.
   Where the export hardcodes a hex, that hex is preserved. */

/* ── Buttons ─────────────────────────────────────────────────────────── */
export function NeonButton({
  children, variant = "primary", className = "", style = {}, ...rest
}) {
  const C = useC();

  if (variant === "primary") {
    return (
      <button
        className={`relative px-5 py-3 font-bold angular-sm overflow-hidden ${className}`}
        style={{
          background: "linear-gradient(135deg, #9333EA 0%, #D946EF 100%)",
          boxShadow: "0 0 20px rgba(217,70,239,.5), 0 0 40px rgba(147,51,234,.25)",
          color: "#FFFFFF",
          fontSize: ".95rem",
          ...style,
        }}
        {...rest}
      >
        <span className="relative z-10">{children}</span>
      </button>
    );
  }

  return (
    <button
      className={`px-5 py-3 font-medium angular-sm transition-all duration-300 ${className}`}
      style={{
        background: "rgba(17,16,31,.9)",
        border: `1px solid ${C.edge}`,
        color: C.irisDeep,
        fontSize: ".95rem",
        boxShadow: "0 0 10px rgba(147,51,234,.12)",
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ── Circuit decoration ──────────────────────────────────────────────── */
/* The PCB trace motif from the export. Decorative only, so it's hidden
   from assistive technology and never sized to affect layout. */
export function PcbDecor({ className = "", style = {} }) {
  return (
    <svg
      className={className}
      width="300"
      height="200"
      viewBox="0 0 300 200"
      fill="none"
      aria-hidden="true"
      style={{ opacity: 0.18, pointerEvents: "none", ...style }}
    >
      <line x1="0" y1="40" x2="120" y2="40" stroke="#D946EF" strokeWidth="1" />
      <line x1="140" y1="40" x2="300" y2="40" stroke="#D946EF" strokeWidth="1" />
      <line x1="0" y1="100" x2="80" y2="100" stroke="#A855F7" strokeWidth="1" />
      <line x1="100" y1="100" x2="220" y2="100" stroke="#A855F7" strokeWidth="1" />
      <line x1="0" y1="160" x2="160" y2="160" stroke="#D946EF" strokeWidth="1" />
      <line x1="60" y1="0" x2="60" y2="40" stroke="#D946EF" strokeWidth="1" />
      <line x1="60" y1="60" x2="60" y2="100" stroke="#D946EF" strokeWidth="1" />
      <line x1="60" y1="120" x2="60" y2="200" stroke="#D946EF" strokeWidth="1" />
      <line x1="160" y1="0" x2="160" y2="40" stroke="#A855F7" strokeWidth="1" />
      <line x1="160" y1="60" x2="160" y2="160" stroke="#A855F7" strokeWidth="1" />
      <line x1="240" y1="40" x2="240" y2="100" stroke="#D946EF" strokeWidth="1" />
      <circle cx="60" cy="40" r="3" fill="#D946EF" />
      <circle cx="60" cy="100" r="3" fill="#D946EF" />
      <circle cx="60" cy="160" r="2.5" fill="#A855F7" />
      <circle cx="160" cy="40" r="3" fill="#A855F7" />
      <circle cx="240" cy="100" r="2.5" fill="#D946EF" />
    </svg>
  );
}

/* ── The uppercase micro-type ────────────────────────────────────────── */
export function HudLabel({ children, className = "", style = {} }) {
  const C = useC();
  return (
    <span className={`hud-label ${className}`} style={{ color: C.irisDeep, ...style }}>
      {children}
    </span>
  );
}

/* ── The pulsing state dot ───────────────────────────────────────────── */
export function GlowDot({ color, size = 6 }) {
  const C = useC();
  const c = color || C.neon;
  return (
    <span
      className="rounded-full shrink-0"
      style={{
        width: size,
        height: size,
        background: c,
        boxShadow: `0 0 8px ${c}, 0 0 16px ${c}66`,
        animation: "pulse-glow 2s ease-in-out infinite",
      }}
    />
  );
}
