/* One long document, read in parts and put back together.

   A Vercel function refuses a request body over 4.5 MB, and a scanned PDF of
   more than a few pages is bigger than that however small its pages are
   rendered. It used to be read up to the limit and the rest of its pages
   dropped, which on a supplier invoice means invoice lines missing from stock
   with only a small notice to say so.

   So the browser sends it in parts. Every part but the last asks only for the
   model's reading (`partial: true`); the last carries those readings back
   (`previous`), and they are joined here, in page order, before anything is
   matched. Matching, the totals and the "6 of 9 matched" count are then worked
   out once, on the whole document, by the same code that handles a short one,
   instead of being stitched together from per-part answers that each only saw
   a slice.

   Each part is a model call and claims a scan like any other. */

export const PART_KINDS = ["supplier", "recipe", "inventory"];

/* Sixty pages at the smallest a page is rendered is well under this many
   parts; it only ever stops a hand-made payload. */
export const MAX_PARTS = 20;

/* Figures a document prints once, at its end. Taken as a set from the last
   part that states any of them, so a subtotal read off page one is never paired
   with a total read off page six. */
const CLOSING = {
  supplier: ["subtotal", "tax", "total"],
};

const isEmpty = (v) => v == null || (typeof v === "string" && !v.trim());
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/* The readings a final part brought with it, checked before they are trusted
   with anything. Absent means a document read in one go. */
export function readPrevious(kind, previous) {
  if (previous == null) return { parts: [] };
  if (!Array.isArray(previous)) return { error: "previous" };
  if (!previous.length) return { parts: [] };
  if (!PART_KINDS.includes(kind)) return { error: "kind" };
  if (previous.length >= MAX_PARTS) return { error: "toomany", limit: MAX_PARTS };
  if (!previous.every(isPlainObject)) return { error: "previous" };
  return { parts: previous };
}

/* Join the readings of consecutive parts of one document.

   Lists are concatenated in order: the lines of page one, then page two. A
   single value (the supplier, the invoice number, the dish name) is taken
   from the first part that states it, since a document names itself at the
   top and a running header on a later page restates it at best. The figures
   in CLOSING come from the end instead. */
export function joinParts(kind, parts) {
  if (parts.length === 1) return parts[0];

  const closing = CLOSING[kind] || [];
  const joined = {};
  for (const part of parts) {
    for (const [key, value] of Object.entries(part || {})) {
      if (closing.includes(key)) continue;
      if (Array.isArray(value)) {
        joined[key] = [...(Array.isArray(joined[key]) ? joined[key] : []), ...value];
      } else if (!(key in joined) || (isEmpty(joined[key]) && !isEmpty(value))) {
        joined[key] = value;
      }
    }
  }

  if (closing.length) {
    const last = [...parts].reverse().find((p) => closing.some((key) => !isEmpty(p?.[key])));
    for (const key of closing) joined[key] = last ? (last[key] ?? null) : null;
  }

  return joined;
}
