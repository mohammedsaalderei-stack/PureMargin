import { UNITS, convert, sameDimension } from "./_units.js";

/* Reading a unit off a page.

   The ledger speaks in a fixed set of keys — kg, g, l, ml, ea and so on — and
   everything downstream depends on that. A scan does not: an invoice from an
   Emirati supplier says كجم, a recipe card written by a Filipino chef says
   tasa, an American supplier's sheet says LBS, and a delivery note says
   "Kilogram" in full. Every one of those is the same unit, and until now every
   one of them failed to match and left the line unusable.

   This is spelling, not conversion. `convert` in _units.js already turns
   pounds into grams correctly; what it cannot do is recognise that "رطل" was
   the word for pounds. Separating the two keeps the arithmetic in one place
   and the vocabulary in another, so adding a language is adding words rather
   than touching anything that multiplies.

   A word this does not recognise is returned as null rather than guessed. A
   wrong unit is worse than an unknown one: unknown stops and asks, wrong
   multiplies a stock balance by a thousand and looks confident doing it. */

const ALIASES = {
  /* mass */
  kg: ["kg", "kgs", "kilo", "kilos", "kilogram", "kilogramme", "kilograms", "kilogrammes",
       "كجم", "كغ", "كيلو", "كيلوغرام", "كيلوجرام",
       "किलो", "किग्रा", "किलोग्राम",
       "kilo", "kilong", "kg."],
  g: ["g", "gm", "gms", "gr", "gram", "grams", "gramme", "grammes",
      "جم", "جرام", "غرام", "غ",
      "ग्राम", "ग्रा", "gramo"],
  oz: ["oz", "ozs", "ounce", "ounces", "أونصة", "اونصة", "औंस", "onsa"],
  lb: ["lb", "lbs", "pound", "pounds", "رطل", "أرطال", "पाउंड", "libra"],

  /* volume */
  l: ["l", "lt", "ltr", "ltrs", "litre", "litres", "liter", "liters",
      "لتر", "ل", "لترات", "लीटर", "litro"],
  ml: ["ml", "mls", "millilitre", "millilitres", "milliliter", "milliliters",
       "مل", "مللتر", "مليلتر", "मिली", "मिलीलीटर", "mililitro"],
  tsp: ["tsp", "tsps", "teaspoon", "teaspoons", "ملعقة صغيرة", "ملعقة شاي",
        "छोटा चम्मच", "छोटी चम्मच", "kutsarita"],
  tbsp: ["tbsp", "tbsps", "tbs", "tablespoon", "tablespoons", "ملعقة كبيرة", "ملعقة طعام",
         "बड़ा चम्मच", "बड़ी चम्मच", "kutsara"],
  cup: ["cup", "cups", "كوب", "أكواب", "كاسة", "कप", "प्याला", "tasa"],
  floz: ["floz", "fl oz", "fluid ounce", "fluid ounces", "أونصة سائلة", "फ्लूइड औंस"],

  /* count */
  ea: ["ea", "each", "pc", "pcs", "piece", "pieces", "unit", "units", "no", "nos",
       "حبة", "حبات", "قطعة", "قطع", "عدد", "وحدة",
       "नग", "पीस", "अदद", "piraso", "pcs."],
  dozen: ["dozen", "dozens", "dz", "دزينة", "درزن", "दर्जन", "dosena"],
};

/* Packaging words are not units. A supplier writing "3 SACK" has told you how
   it was delivered, not what the shelf counts, and silently reading a sack as
   a kilo would put a number in the ledger nobody measured. Recognised so the
   screen can say "this is a pack size, tell me what one contains" rather than
   shrugging at a word it has never seen. */
const PACKAGING = new Set([
  "box", "boxes", "carton", "cartons", "case", "cases", "crate", "crates",
  "sack", "sacks", "bag", "bags", "tin", "tins", "can", "cans", "jar", "jars",
  "tub", "tubs", "pkt", "pkts", "packet", "packets", "pack", "packs",
  "bottle", "bottles", "tray", "trays", "bundle", "bundles", "roll", "rolls",
  "صندوق", "كرتون", "كيس", "أكياس", "علبة", "علب", "تنكة", "زجاجة", "قارورة",
  "डिब्बा", "पैकेट", "बोरी", "बोतल",
  "kahon", "sako", "supot", "lata", "bote",
]);

const LOOKUP = new Map();
for (const [key, words] of Object.entries(ALIASES)) {
  for (const word of words) LOOKUP.set(word, key);
}

function tidy(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    /* Arabic-Indic and Persian digits, so "٥ كجم" reads as 5 kg. */
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    /* Arabic diacritics carry no meaning for matching a unit name. */
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[.\u060C,;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* The canonical unit key for a word in any of the supported languages, or null
   when it is not a unit this ledger keeps. */
export function normaliseUnit(raw) {
  const text = tidy(raw);
  if (!text) return null;
  if (UNITS[text]) return text;
  if (LOOKUP.has(text)) return LOOKUP.get(text);

  /* "5kg" and "kg." arrive stuck together often enough to be worth stripping
     rather than refusing. */
  const bare = text.replace(/^[\d\s./]+/, "").trim();
  if (bare && LOOKUP.has(bare)) return LOOKUP.get(bare);
  if (bare && UNITS[bare]) return bare;

  return null;
}

export function isPackaging(raw) {
  const text = tidy(raw);
  return Boolean(text) && PACKAGING.has(text);
}

/* A quantity read off a page, expressed in the unit the shelf is kept in.

   Returns null rather than a number whenever the two cannot be reconciled — a
   count converted into a mass is not a conversion, it is a pack size somebody
   has to supply. */
export function toStockUnit(qty, rawUnit, stockUnit) {
  const from = normaliseUnit(rawUnit);
  const to = normaliseUnit(stockUnit);
  const n = Number(qty);

  if (!from || !to || !Number.isFinite(n)) return null;
  if (from === to) return { qty: n, unit: to, converted: false };
  if (!sameDimension(from, to)) return null;

  const out = convert(n, from, to);
  if (!Number.isFinite(out)) return null;
  /* Rounded to something a store person would write down. Six places is past
     the precision of any scale in a kitchen. */
  return { qty: Math.round(out * 1e6) / 1e6, unit: to, converted: true, from };
}
