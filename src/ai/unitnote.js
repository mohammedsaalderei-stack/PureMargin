import { fill } from "../i18n.jsx";

/* A refused line, in words somebody can act on.

   ── What this replaces ───────────────────────────────────────────────────

   "The unit of one of the lines does not suit that ingredient." That was the
   whole message, on a delivery of forty-eight lines and on a recipe of thirty,
   with nothing said about which line or what would fix it. It was also shown
   for three quite different problems, two of which the app can now settle by
   itself:

     a spelling — "Kg", "L", "Pcs", "كجم". Read by `_unitwords.js` at the
                  commit boundary now, so it never reaches a person at all.
     a pack     — "3 SACK". Not a unit and never will be; what is missing is
                  how much one holds. That is a question with an answer.
     a mismatch — pieces offered where kilograms are kept. The only one of the
                  three that genuinely needs a decision, and the only one worth
                  stopping for. It arrives as "unit", from the ingredient-aware
                  check, and is the case that carries both units to quote.

   ── Why it lives in its own file ─────────────────────────────────────────

   Two screens show it — a delivery and a recipe — and the last time an error
   mapping was copied into two components one of the copies went on checking
   for a code the server had stopped returning. One reading, both callers. */

export function unitNote(s, refused) {
  if (!refused) return "";

  const name = refused.name || refused.ingredientName || "";
  const unit = refused.unit || "";
  const stockUnit = refused.stockUnit || "";
  const reason = refused.reason || refused.error || "";

  /* A packaging word is a question, not a rejection: say which word, and what
     is missing about it. */
  if (reason === "packaging") return fill(s.errPack, { unit: unit || "—" });

  if (reason === "unit" || reason === "unitword") {
    /* Both units and a name is the whole explanation in one line. Without them
       there is nothing better to say than the old sentence. */
    return name && stockUnit && unit
      ? fill(s.errUnitOne, { name, unit, stockUnit })
      : s.errUnit;
  }

  return "";
}

/* Names in a row, separated the way the reader's language separates them.

   Arabic puts a "،" where English puts a ",", and a list of ingredients that
   gets this wrong reads as though it were written by a machine. */
export function nameList(names, lang) {
  const clean = (names || []).filter(Boolean);
  if (!clean.length) return "";
  try {
    return new Intl.ListFormat(lang, { style: "short", type: "unit" }).format(clean);
  } catch {
    return clean.join(lang === "ar" || lang === "ur" ? "، " : ", ");
  }
}
