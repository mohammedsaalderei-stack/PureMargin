import { useId } from "react";

/* The PM mark, drawn as neon tube.

   Rebuilt as vector rather than using the supplied PNG: the artwork has a
   circuit-board background baked into the raster, and the brief was letters
   only. Vector also means it stays sharp at 24px in the sidebar and at
   620px on the splash, and the glow can respond to state instead of being
   fixed in the image.

   The tube is three passes over one path — a wide soft bloom, a mid halo,
   then a bright core — which is how a real neon sign reads: the light
   spills further than the glass. */
export default function NeonMark({
  size = 64,
  glow = 1,
  intensity = 1,
  className = "",
  title = "PureMargin",
}) {
  const id = useId().replace(/:/g, "");
  const w = size;
  const h = size * 0.62;

  // P, then M — single-stroke letterforms, rounded like bent tube.
  const P = "M 26 96 L 26 20 L 58 20 A 22 22 0 0 1 58 64 L 26 64";
  const M = "M 100 96 L 100 20 L 130 62 L 160 20 L 160 96";

  const core = `rgba(255,255,255,${0.92 * intensity})`;
  const tube = `rgba(216,180,254,${0.95 * intensity})`;
  const bloom = `rgba(168,85,247,${0.55 * intensity * glow})`;

  return (
    <svg
      viewBox="0 0 186 116"
      width={w}
      height={h}
      className={className}
      role="img"
      aria-label={title}
      style={{ overflow: "visible" }}
    >
      <defs>
        <filter id={`wide-${id}`} x="-90%" y="-90%" width="280%" height="280%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
        <filter id={`mid-${id}`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="3.2" />
        </filter>
      </defs>

      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {/* Outer spill */}
        <g filter={`url(#wide-${id})`} opacity={0.85 * glow}>
          <path d={P} stroke={bloom} strokeWidth="17" />
          <path d={M} stroke={bloom} strokeWidth="17" />
        </g>
        {/* Halo */}
        <g filter={`url(#mid-${id})`} opacity={0.95}>
          <path d={P} stroke={tube} strokeWidth="11" />
          <path d={M} stroke={tube} strokeWidth="11" />
        </g>
        {/* Glass */}
        <path d={P} stroke={tube} strokeWidth="8" opacity={0.9} />
        <path d={M} stroke={tube} strokeWidth="8" opacity={0.9} />
        {/* Filament */}
        <path d={P} stroke={core} strokeWidth="3" />
        <path d={M} stroke={core} strokeWidth="3" />
      </g>
    </svg>
  );
}
