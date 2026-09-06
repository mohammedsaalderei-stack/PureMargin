/* Comparing two pieces of text somebody wrote.

   ── Why one file ─────────────────────────────────────────────────────────

   Three places needed the same thing and each grew its own version: reading a
   unit off a page, matching a supplier's description to an ingredient, and
   looking up a learned alias. They drifted, as copies do — the unit reader
   folded Arabic letter forms and the ingredient matcher did not, so "حبه"
   resolved as a unit while "زبده" failed to find "زبدة" on the shelf.

   ── What it does, and what it deliberately does not ──────────────────────

   It removes differences that are only ever spelling, in every language this
   app is used in:

     case            KG and kg
     spacing         collapsed, so a double space is not a different word
     digits          Arabic-Indic ٥ and Persian ۵ become 5
     Arabic          diacritics dropped; أ إ آ ٱ folded to ا; ة to ه; ى to ي,
                     because a supplier's system and a kitchen's label rarely
                     agree on any of them
     Urdu            ک and ی written the Arabic way, which is how the same word
                     arrives from two keyboards
     Devanagari      the nukta forms — क़ ख़ ग़ ज़ ड़ ढ़ फ़ — written with and
                     without their dot, which Hindi keyboards do both ways
     Latin           accents stripped, so "sauté" and "saute" are one word

   It does not translate, stem, or guess. Two words that mean the same thing in
   different languages stay different words here — that is what the alias list
   on an ingredient is for, and it is a fact somebody states rather than one
   this file could infer. */

/* Unicode NFD splits an accented letter into the letter plus its mark, so the
   marks can be removed by range. Applied before the script-specific folding
   below, since Arabic diacritics decompose the same way. */
const COMBINING = /[̀-ͯ]/g;

/* Arabic diacritics: fathatan through sukun, plus superscript alef. */
const HARAKAT = /[ً-ٰٟ]/g;

/* Devanagari nukta, which changes a letter's sound and is typed inconsistently.
   Removing it after NFD folds क़ to क and ज़ to ज. */
const NUKTA = /़/g;

/* Zero-width joiners and marks. Invisible, and a word carrying one does not
   match the same word without it — which is how a copy-pasted name silently
   stops matching the one somebody typed. */
const INVISIBLE = /[​-‏‪-‮⁦-⁩﻿]/g;

export function normaliseText(raw) {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(COMBINING, "")
    .replace(HARAKAT, "")
    .replace(NUKTA, "")
    .replace(INVISIBLE, "")
    .toLowerCase()
    /* Arabic-Indic and Persian digits. */
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    /* Alef in its four written forms, and the two hamza carriers that arrive
       as separate letters from some keyboards. */
    .replace(/[أإآٱ]/g, "ا")
    /* Ta marbuta typed as a plain ha, which is how a good share of delivery
       notes are written. */
    .replace(/ة/g, "ه")
    /* Alef maqsura for ya. */
    .replace(/ى/g, "ي")
    /* Urdu keh and yeh, which Arabic keyboards produce as kaf and ya. */
    .replace(/ک/g, "ك")
    .replace(/[یے]/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

/* The words in a phrase, in any script.

   Splitting on `[^a-z0-9]+` — which is what this used to be — does not ignore
   Arabic, Hindi or Urdu. It deletes them, so every non-Latin description
   became the empty set and matched nothing at all.

   Marks count as part of a word, not as a boundary between words. Devanagari
   writes its vowels as spacing combining marks — the ी in क़ीमा is one — and a
   split that treats them as punctuation does not merely mishandle Hindi, it
   shatters every word into single consonants: "क़ीमा 5 किलो" came apart as
   क, म, 5, क, ल, which then failed the length filter and matched nothing.
   Arabic's own marks are already gone by this point, stripped above, so
   including them here costs nothing and fixes the script that needs them. */
export function words(raw) {
  return normaliseText(raw).split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean);
}
