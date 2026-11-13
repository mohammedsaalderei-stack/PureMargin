/* Why a print failed, in the cashier's language.

   The print layer answers with a code — "paperout", "bridgeoffline" — and
   never with a sentence, so that the sentence can be in Arabic. This is
   where the two meet. A code nobody wrote a sentence for still gets one. */

import { fill } from "../i18n.jsx";

export const printReason = (P, code) => P.print.reasons[code] || P.print.reasons.generic;

/* "Kitchen: The printer is out of paper." */
export const printProblem = (P, result) => fill(P.print.failedOn, {
  printer: result?.name || P.settings.printers.unnamed,
  reason: printReason(P, result?.error),
});
