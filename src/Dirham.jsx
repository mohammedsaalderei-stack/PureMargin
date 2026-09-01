/* The UAE Dirham mark, as issued by the Central Bank in 2025.

   Traced from the Central Bank's own artwork rather than drawn from
   measurements. The previous version was hand-built and recognisably wrong:
   stroked outlines instead of a solid glyph, and the two bars crossing only on
   the left when they cross on both sides. A national currency symbol either
   looks right or it looks like a mistake, and this one is on every price in
   the product.

   Filled with `evenodd` so the counter of the D and the gaps between the bars
   stay open. Coloured with `currentColor`, so it inherits whatever the text
   around it is doing — including the cyan of the margin figure on the
   dashboard — and needs no variant per palette.

   Deliberately not the Unicode codepoint. Font coverage is still thin and a
   missing glyph renders as a box, which on a price is worse than no symbol at
   all. */

const VIEW_W = 27.64;
const PATH = "M12.57 24.03L2.42 24.00L2.73 23.69L3.17 22.87L3.49 21.80L3.61 15.64L1.82 15.61L1.26 15.42L0.88 15.17L0.53 14.83L0.09 14.01L-0.03 13.45L-0.03 12.63L0.06 12.60L0.75 13.10L1.26 13.23L3.52 13.23L3.55 10.81L1.70 10.77L1.01 10.46L0.47 9.93L0.16 9.36L-0.03 8.61L-0.03 7.79L0.44 8.14L1.07 8.39L3.52 8.39L3.61 8.29L3.55 2.76L3.17 1.26L2.51 -0.03L12.57 -0.03L15.27 0.35L17.15 0.91L18.53 1.54L19.66 2.23L20.61 2.98L21.33 3.71L22.59 5.47L23.28 6.97L23.75 8.39L25.76 8.39L26.26 8.51L26.70 8.76L27.24 9.30L27.55 9.86L27.68 10.30L27.64 11.47L27.20 11.03L26.45 10.77L24.13 10.77L24.09 13.13L25.95 13.23L26.76 13.60L27.36 14.26L27.61 14.89L27.64 16.24L27.14 15.80L26.64 15.61L23.69 15.61L23.21 17.28L22.34 19.04L21.39 20.29L20.17 21.46L18.97 22.27L17.40 23.03L15.02 23.72L12.57 24.03ZM19.57 8.36L19.26 6.85L18.50 4.96L17.75 3.83L16.77 2.86L15.96 2.29L14.76 1.73L13.07 1.29L11.06 1.16L7.26 1.19L7.29 8.39L19.57 8.36ZM19.82 13.19L19.79 10.77L7.26 10.81L7.29 13.23L19.82 13.19ZM10.90 22.81L13.01 22.65L14.14 22.40L15.90 21.64L16.71 21.08L17.81 19.98L18.44 19.04L19.07 17.65L19.57 15.64L7.29 15.61L7.26 22.81L10.90 22.81Z";

export function DirhamMark({ size = "0.95em", className = "", style = {} }) {
  return (
    <svg
      viewBox={`0 0 ${VIEW_W} 24`}
      height={size}
      /* Width follows the glyph's own proportions rather than being forced
         square, which is what made the old mark sit oddly beside a number. */
      width={`calc(${size} * ${VIEW_W / 24})`}
      fill="currentColor"
      fillRule="evenodd"
      clipRule="evenodd"
      role="img"
      aria-label="AED"
      className={className}
      style={{ display: "inline-block", verticalAlign: "-0.06em", flexShrink: 0, ...style }}
    >
      <path d={PATH} />
    </svg>
  );
}

/* Amount with the mark. Always renders LTR — currency amounts are written
   left-to-right in Arabic too, with the symbol leading.

   Whole dirhams by default, which is right for the figures this was written
   for: a day's sales, a month's food cost, a margin. It is wrong for the two
   places money is small — an invoice line at 1,312.50, and a unit cost at 22.80
   a kilo, where rounding to 23 loses the digit the number exists to show. Hence
   `decimals`, rather than a second formatter in each of those screens that
   would drift from this one's grouping and locale. */
export function Money({ value, size, decimals = 0, className = "", style = {} }) {
  const amount = (Number(value) || 0).toLocaleString("en-AE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
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
