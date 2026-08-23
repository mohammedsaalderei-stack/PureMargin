/* Units and conversions.

   Everything in costing eventually divides one quantity by another, and the two
   are almost never in the same unit: stock is counted in kilograms, recipes call
   for grams, purchases arrive in cases of twelve bottles. Getting this wrong
   doesn't produce an error — it produces a food cost that is out by a factor of a
   thousand and looks plausible. So conversion lives in one place, with one rule:
   a quantity only converts inside its own dimension, and anything else returns
   null rather than a number.

   Each unit is defined by how many base units it holds (grams for mass,
   millilitres for volume, pieces for count). Conversion is therefore
   multiply-to-base then divide-to-target, never a table of pairs.

   Mass and volume deliberately do not convert into each other. A litre of oil
   and a kilogram of oil are different quantities, and the density that relates
   them belongs to the ingredient, not to the unit system. */

export const DIMENSIONS = ["mass", "volume", "count"];

export const UNITS = {
  // mass — base: gram
  mg: { dimension: "mass", inBase: 0.001, label: "mg" },
  g: { dimension: "mass", inBase: 1, label: "g" },
  kg: { dimension: "mass", inBase: 1000, label: "kg" },
  oz: { dimension: "mass", inBase: 28.349523125, label: "oz" },
  lb: { dimension: "mass", inBase: 453.59237, label: "lb" },

  // volume — base: millilitre
  ml: { dimension: "volume", inBase: 1, label: "ml" },
  cl: { dimension: "volume", inBase: 10, label: "cl" },
  l: { dimension: "volume", inBase: 1000, label: "L" },
  tsp: { dimension: "volume", inBase: 4.92892159375, label: "tsp" },
  tbsp: { dimension: "volume", inBase: 14.78676478125, label: "tbsp" },
  cup: { dimension: "volume", inBase: 236.5882365, label: "cup" },
  floz: { dimension: "volume", inBase: 29.5735295625, label: "fl oz" },
  gal: { dimension: "volume", inBase: 3785.411784, label: "gal" },

  /* count — base: piece. `dozen` earns its place because suppliers price by it;
     anything else pack-shaped (a case, a tray, a sack) is item-specific and
     belongs to that item's pack size, not here. A global "case" unit would be a
     different quantity for every ingredient that used it. */
  ea: { dimension: "count", inBase: 1, label: "each" },
  dozen: { dimension: "count", inBase: 12, label: "dozen" },
};

export const UNIT_KEYS = Object.keys(UNITS);

export function isUnit(unit) {
  return Object.prototype.hasOwnProperty.call(UNITS, unit);
}

export function dimensionOf(unit) {
  return UNITS[unit]?.dimension || null;
}

export function sameDimension(a, b) {
  return isUnit(a) && isUnit(b) && UNITS[a].dimension === UNITS[b].dimension;
}

/* Convert a quantity between units of the same dimension.
   Returns null — never a guess and never a throw — when the units don't relate,
   so a caller has to decide what an unconvertible quantity means. */
export function convert(qty, from, to) {
  if (!Number.isFinite(qty)) return null;
  if (!sameDimension(from, to)) return null;
  if (from === to) return qty;
  return (qty * UNITS[from].inBase) / UNITS[to].inBase;
}

/* A quantity expressed in its dimension's base unit. This is what gets stored
   on a movement or a recipe line: the entered unit is kept for display, the base
   quantity is what arithmetic uses, so a later unit change can't silently
   restate history. */
export function toBase(qty, unit) {
  if (!isUnit(unit) || !Number.isFinite(qty)) return null;
  return qty * UNITS[unit].inBase;
}

export function fromBase(baseQty, unit) {
  if (!isUnit(unit) || !Number.isFinite(baseQty)) return null;
  return baseQty / UNITS[unit].inBase;
}

/* The cost of one base unit, given a purchase: "a case of 12 × 1L bottles for
   90" becomes a cost per millilitre. `packSize` is how many stock units are in
   one purchase unit — the item-specific part that the global unit table can't
   know.

   Returns null rather than 0 or Infinity for a degenerate pack, because "free"
   and "unknown" must not look the same downstream. */
export function costPerBase({ price, packSize = 1, packUnit }) {
  if (!Number.isFinite(price) || price < 0) return null;
  if (!Number.isFinite(packSize) || packSize <= 0) return null;
  const base = toBase(packSize, packUnit);
  if (base === null || base <= 0) return null;
  return price / base;
}

/* Units grouped for a picker, so the interface never offers a conversion that
   would return null. */
export function unitsByDimension() {
  const out = { mass: [], volume: [], count: [] };
  for (const key of UNIT_KEYS) out[UNITS[key].dimension].push({ key, label: UNITS[key].label });
  return out;
}
