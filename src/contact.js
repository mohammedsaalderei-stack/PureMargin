/* Your business's own contact details.

   These are deliberately empty. Anything left blank is hidden rather than
   shown as a placeholder — an app that displays "+971 00 000 0000" to a
   customer is worse than one that shows no phone number at all.

   Fill in what you have, delete what you don't. */
export const CONTACT = {
  email: "",
  phone: "",
  instagram: "",
};

export const phoneHref = (p) => (p ? `tel:${p.replace(/[^\d+]/g, "")}` : "");
export const instagramHref = (h) =>
  h ? `https://instagram.com/${h.replace(/^@/, "")}` : "";
export const emailHref = (e) => (e ? `mailto:${e}` : "");

/* Only the details that are actually filled in. */
export function contactRows() {
  const rows = [];
  if (CONTACT.phone) rows.push({ kind: "phone", label: CONTACT.phone, href: phoneHref(CONTACT.phone) });
  if (CONTACT.email) rows.push({ kind: "email", label: CONTACT.email, href: emailHref(CONTACT.email) });
  if (CONTACT.instagram)
    rows.push({ kind: "instagram", label: CONTACT.instagram, href: instagramHref(CONTACT.instagram) });
  return rows;
}

export const hasContact = () => contactRows().length > 0;
