import { useLang } from "./i18n.jsx";

/* The asterisk on a required field.

   Marked up rather than typed into the label text, so the character carries
   meaning to a screen reader instead of being read out as punctuation in the
   middle of a sentence. `aria-hidden` on the glyph, the word itself in a
   visually hidden span, which is the pairing assistive technology expects.

   Every form that uses this also prints the legend once, because an asterisk
   nobody has defined is decoration. */
export function Req() {
  const { t } = useLang();
  return (
    <>
      <span aria-hidden="true" style={{ color: "#E11D48" }}>&nbsp;*</span>
      <span className="sr-only">{t.register.required}</span>
    </>
  );
}

export function RequiredLegend({ color }) {
  const { t } = useLang();
  return (
    <p className="text-[11px] mb-4" style={{ color }}>{t.register.requiredLegend}</p>
  );
}
