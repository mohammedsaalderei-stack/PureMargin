import { useId } from "react";

/* PureMargin — geometric gradient mark.
   Two vertical bars (revenue and cost) with a visible gap between them:
   the margin. Clean vector, no glow, sharp at any size. */
export default function BrandMark({ size = 34, className = "", title = "PureMargin" }) {
  const id = useId().replace(/:/g, "");
  const h = size * 0.62;

  return (
    <svg
      viewBox="0 0 48 30"
      width={size}
      height={h}
      className={className}
      role="img"
      aria-label={title}
    >
      <defs>
        <linearGradient id={`pm-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8B5CF6" />
          <stop offset="100%" stopColor="#06B6D4" />
        </linearGradient>
      </defs>
      {/* Left bar — revenue */}
      <rect x="3" y="4" width="9" height="22" rx="3" fill={`url(#pm-${id})`} />
      {/* Right bar — cost, shorter */}
      <rect x="22" y="11" width="9" height="15" rx="3" fill={`url(#pm-${id})`} opacity="0.55" />
      {/* The gap between them is the margin — emphasised by a small accent dot */}
      <circle cx="17" cy="15" r="2" fill="#06B6D4" />
      {/* M letterform suggestion — two diagonal strokes */}
      <path
        d="M 33 26 L 33 4 L 40 15 L 47 4 L 47 26"
        fill="none"
        stroke={`url(#pm-${id})`}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.9"
      />
    </svg>
  );
}
