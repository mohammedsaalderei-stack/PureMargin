/* Money, in the only representation that survives arithmetic.

   ── Why a double is not good enough, and why that is not obvious ─────────

   Every monetary value in this app is currently a JavaScript number, and until
   now that has been almost fine. Figures are rounded at the edge of the
   response, sums are short, and the error hides under the rounding. Nobody has
   seen a wrong total.

   Two things in the specification make it stop being fine, and both are about
   *dividing* rather than adding:

     §6  "allocate rounding residuals deterministically across lines"
     §6  order-level discounts allocated proportionally to lines

   Splitting 100.00 three ways in doubles gives 33.333333333333336 three times,
   which rounds to 33.33 three times, which is 99.99. A cent has evaporated,
   and it evaporates again on every order for ever. That is the class of bug
   that surfaces as a reconciliation that is always off by a little, months
   after anybody remembers changing anything.

   ── Integer minor units, not a decimal library ───────────────────────────

   The obvious move is to add decimal.js. This does not, and the reason is
   scope: a decimal library is arbitrary precision and general arithmetic, and
   what this app needs is exact addition, subtraction, and one allocation rule,
   over currencies with at most three decimal places.

   So money is an integer count of the smallest unit — fils for AED, cents for
   USD — and the only operations offered are the ones that cannot lose money.
   Integers up to 2^53 are exact in a double, which is nine hundred billion
   dirhams; a restaurant reaching that has other problems.

   Quantities are deliberately NOT money and are not handled here. A recipe
   line of 0.375 kg is a measurement, base units already keep it on one scale,
   and forcing it through a minor-unit integer would be the factor-of-1000
   error `_units.js` exists to prevent.

   ── What the database does with this ─────────────────────────────────────

   Postgres stores these as NUMERIC — §6 proposes NUMERIC(20,6) — and `pg`
   hands NUMERIC back as a *string*, precisely so a driver cannot silently
   round it on the way through. `fromDb` is the seam where that string becomes
   a minor-unit integer, and it is the only place a database value is allowed
   to enter the arithmetic. */

/* Where the decimal point sits, per currency.

   Three is not a mistake. Kuwaiti, Bahraini and Omani currencies have three
   decimal places, and a Gulf product that assumes two will be wrong in three
   neighbouring countries. Absent means two, which is the common case. */
const PLACES = { AED: 2, USD: 2, EUR: 2, GBP: 2, SAR: 2, QAR: 2, KWD: 3, BHD: 3, OMR: 3, JPY: 0 };

export const placesFor = (currency) => PLACES[String(currency || "AED").toUpperCase()] ?? 2;

const factorFor = (currency) => 10 ** placesFor(currency);

/* The largest integer a double represents exactly. Beyond this, addition stops
   being associative and every guarantee in this file evaporates — so it is
   refused loudly rather than carried silently. */
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

export class MoneyError extends Error {
  constructor(code, detail = "") {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

const guard = (n) => {
  if (!Number.isFinite(n)) throw new MoneyError("notfinite");
  if (!Number.isSafeInteger(n)) throw new MoneyError("toolarge", String(n));
  return n;
};

/* A human's number — 24.5, "24.50", "24.5 " — as minor units.

   Rounded half away from zero, which is what a person means by "round to the
   nearest fils" and what a till receipt does. Banker's rounding is defensible
   for statistics and surprising on a bill.

   The multiply is done on a string-free path deliberately: 24.5 * 100 is
   2449.9999999999995 in binary floating point, and `Math.round` of that is
   still 2450, but 1.005 * 100 is 100.49999999999999 and rounds to 100 rather
   than 101. So the shift is done in decimal text, where it is exact. */
export function toMinor(value, currency = "AED") {
  if (value === null || value === undefined || value === "") return 0;

  const raw = String(value).trim().replace(/[\s,_]/g, "");
  if (!/^-?\d*(\.\d*)?$/.test(raw) || raw === "" || raw === "-" || raw === ".") {
    throw new MoneyError("shape", String(value));
  }

  const places = placesFor(currency);
  const negative = raw.startsWith("-");
  const [whole, fraction = ""] = raw.replace(/^-/, "").split(".");

  /* Padded to the currency's places, plus the one digit that decides the
     rounding. Nothing beyond that digit can change the outcome: at five or
     above the value is at least half a unit and rounds away from zero, below
     five it cannot reach half however many digits follow. */
  const padded = (fraction + "0".repeat(places + 1)).slice(0, places + 1);
  const decider = Number(padded[places] || "0");

  let minor = Number((whole || "0") + padded.slice(0, places));
  guard(minor);
  if (decider >= 5) minor += 1;

  return guard(negative ? -minor : minor);
}

/* Minor units back to a decimal string, which is what a JSON response should
   carry. §7: "JSON monetary values are decimal strings."

   A string rather than a number because the moment this becomes a double again
   the caller can do arithmetic on it, and this file exists to stop that. */
export function toDecimalString(minor, currency = "AED") {
  const places = placesFor(currency);
  const n = guard(Math.trunc(Number(minor) || 0));
  const sign = n < 0 ? "-" : "";
  const digits = String(Math.abs(n)).padStart(places + 1, "0");
  if (places === 0) return sign + digits;
  return `${sign}${digits.slice(0, -places)}.${digits.slice(-places)}`;
}

/* What `pg` hands back for a NUMERIC column: a string, never a number.

   The driver returns NUMERIC as text on purpose — it cannot know the column's
   scale fits a double, so it refuses to guess. This is the one doorway a
   database value takes into the arithmetic, and it goes through `toMinor` like
   any other written figure. */
export const fromDb = (value, currency = "AED") =>
  (value === null || value === undefined ? null : toMinor(value, currency));

/* And back out, as the text NUMERIC wants. */
export const toDb = (minor, currency = "AED") => toDecimalString(minor, currency);

/* ── Arithmetic that cannot lose money ──────────────────────────────────── */

export const add = (...parts) => guard(parts.reduce((n, p) => n + guard(Math.trunc(p || 0)), 0));
export const subtract = (a, b) => guard(guard(Math.trunc(a || 0)) - guard(Math.trunc(b || 0)));

/* A price times a quantity, where the quantity is a measurement and not money.

   This is the one place a non-integer legitimately enters, and it is also the
   one multiplication that can produce a fraction of a fils. Rounded once,
   here, rather than left to accumulate. */
export function multiply(minor, quantity) {
  const q = Number(quantity);
  if (!Number.isFinite(q)) throw new MoneyError("notfinite");
  const exact = guard(Math.trunc(minor || 0)) * q;
  if (!Number.isFinite(exact)) throw new MoneyError("notfinite");
  return guard(Math.round(Math.abs(exact)) * (exact < 0 ? -1 : 1));
}

/* ── The allocation, which is the whole reason this file exists ──────────

   Splitting an amount across lines so that the parts add back to the whole.

   The naive version rounds each share independently and loses the remainder.
   This one gives every line its floor, then hands out the leftover units one
   at a time — largest fractional part first, so the line that was rounded down
   hardest is the line that gets the extra fils.

   Ties break by position, which makes the result deterministic: the same
   inputs always allocate the same way, on any machine, on any run. §6 asks for
   exactly that, and a discount that moves between lines depending on iteration
   order is a discount nobody can reconcile.

   Weights are typically the line totals. All-zero weights — a hundred per cent
   discount, every line free — would otherwise divide by zero, so the amount is
   spread evenly instead, which is the only defensible reading of "in
   proportion to nothing". */
export function allocate(minor, weights = []) {
  const total = guard(Math.trunc(minor || 0));
  const w = weights.map((x) => Math.abs(Number(x) || 0));
  if (w.length === 0) return [];

  const sum = w.reduce((n, x) => n + x, 0);
  const shares = sum > 0 ? w : w.map(() => 1);
  const denominator = sum > 0 ? sum : w.length;

  const sign = total < 0 ? -1 : 1;
  const amount = Math.abs(total);

  const exact = shares.map((x) => (amount * x) / denominator);
  const floors = exact.map((x) => Math.floor(x));
  let left = amount - floors.reduce((n, x) => n + x, 0);

  /* Largest remainder first, position breaking ties. */
  const order = exact
    .map((x, i) => ({ i, remainder: x - Math.floor(x) }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);

  const out = [...floors];
  for (let k = 0; left > 0; k += 1, left -= 1) out[order[k % order.length].i] += 1;

  return out.map((x) => guard(x * sign));
}
