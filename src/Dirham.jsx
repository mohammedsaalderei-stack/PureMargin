/* The new UAE Dirham mark, introduced by the Central Bank in 2025.
   Drawn as SVG rather than typed as a character: the codepoint has no
   dependable font coverage yet, and a missing glyph renders as a box.
   Swap in the Central Bank's official asset when you have it — only
   this file needs to change. */

export function DirhamMark({ size = "0.95em", className = "", style = {} }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="AED"
      className={className}
      style={{ display: "inline-block", verticalAlign: "-0.08em", flexShrink: 0, ...style }}
    >
      <path d="M8.2 4.2v15.6" />
      <path d="M8.2 4.2h3.3c4.6 0 7.4 3.1 7.4 7.8s-2.8 7.8-7.4 7.8H8.2" />
      <path d="M3.6 9.6h12.2" />
      <path d="M3.6 14.4h12.2" />
    </svg>
  );
}

/* Amount with the mark. Always renders LTR — currency amounts are written
   left-to-right in Arabic too, with the symbol leading. */
export function Money({ value, size, className = "", style = {} }) {
  const amount = Math.round(Number(value) || 0).toLocaleString("en-AE");
  return (
    <span
      dir="ltr"
      className={`inline-flex items-baseline gap-[0.22em] ${className}`}
      style={style}
    >
      <DirhamMark size={size} />
      <span>{amount}</span>
    </span>
  );
}

/* Plain-text form, for places that can't take markup (aria labels, exports). */
export const moneyText = (n) => `AED ${Math.round(Number(n) || 0).toLocaleString("en-AE")}`;
