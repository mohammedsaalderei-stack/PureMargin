import { useC } from "../theme.jsx";

/* A picture for each thing in the store.

   A list of forty ingredient names is a wall of text, and the eye has nothing
   to catch on when scanning for the tomatoes. A small image per row fixes that
   — but where it comes from matters.

   Not photographs. A stock photo library means a licence per image, a network
   request per row, and a page that breaks when the CDN does. Worse, a photo of
   somebody else's tomatoes is a specific tomato: the wrong variety, the wrong
   colour, sometimes visibly the wrong ingredient. A drawn shape says "tomato"
   without claiming to be one.

   So these are generated, from the name. Category is inferred by matching the
   ingredient's own words in all five languages the product speaks, because an
   Arabic kitchen types طماطم and should get the same picture as one that types
   tomatoes. Nothing is fetched, nothing is licensed, and it works offline.

   A name that matches nothing gets a lettered tile in a colour derived from
   the name itself — stable, so the same ingredient is the same colour on every
   screen, and distinguishable, which is all a scanning eye needs. */

const GROUPS = [
  ["produce", ["tomato", "onion", "potato", "carrot", "lettuce", "cucumber", "pepper", "garlic",
    "lemon", "lime", "herb", "parsley", "mint", "salad", "vegetable", "fruit", "apple", "banana",
    "طماطم", "بصل", "بطاطس", "جزر", "خس", "خيار", "فلفل", "ثوم", "ليمون", "خضار", "نعناع", "بقدونس",
    "टमाटर", "प्याज", "आलू", "गाजर", "नींबू", "सब्ज़ी",
    "ٹماٹر", "پیاز", "آلو", "گاجر", "لیموں", "سبزی",
    "kamatis", "sibuyas", "patatas", "gulay"]],
  ["meat", ["chicken", "beef", "lamb", "mutton", "meat", "steak", "mince", "burger", "kebab",
    "shawarma", "sausage", "bacon", "fish", "prawn", "shrimp", "seafood",
    "دجاج", "لحم", "بقري", "غنم", "سمك", "روبيان", "كباب",
    "चिकन", "मटन", "मछली", "मांस",
    "مرغی", "گوشت", "مچھلی",
    "manok", "baka", "karne", "isda", "hipon"]],
  ["dairy", ["milk", "cheese", "butter", "cream", "yoghurt", "yogurt", "labneh", "egg", "ghee",
    "حليب", "جبن", "زبدة", "قشطة", "لبن", "بيض", "سمن",
    "दूध", "पनीर", "मक्खन", "दही", "अंडा", "घी",
    "دودھ", "پنیر", "مکھن", "دہی", "انڈا", "گھی",
    "gatas", "keso", "mantikilya", "itlog"]],
  ["dry", ["rice", "flour", "pasta", "noodle", "bread", "sugar", "salt", "spice", "lentil",
    "bean", "chickpea", "grain", "oat", "cereal", "basmati", "semolina",
    "أرز", "طحين", "دقيق", "معكرونة", "خبز", "سكر", "ملح", "بهار", "عدس", "حمص",
    "चावल", "आटा", "मैदा", "चीनी", "नमक", "मसाला", "दाल",
    "چاول", "آٹا", "چینی", "نمک", "مصالحہ", "دال",
    "bigas", "harina", "asin", "asukal"]],
  ["oil", ["oil", "olive", "vinegar", "sauce", "tahini", "syrup", "honey", "paste",
    "زيت", "زيتون", "خل", "صلصة", "طحينة", "عسل", "دبس",
    "तेल", "सिरका", "चटनी", "शहद",
    "تیل", "سرکہ", "چٹنی", "شہد",
    "mantika", "suka", "sarsa"]],
  ["drink", ["water", "juice", "tea", "coffee", "cola", "soda", "drink", "karak", "beverage",
    "ماء", "مياه", "عصير", "شاي", "قهوة", "مشروب",
    "पानी", "जूस", "चाय", "कॉफ़ी",
    "پانی", "جوس", "چائے", "کافی",
    "tubig", "juice", "kape"]],
  ["packaging", ["box", "bag", "cup", "lid", "napkin", "tissue", "container", "wrap", "foil",
    "straw", "glove", "packaging",
    "علبة", "كيس", "كوب", "غطاء", "منديل", "ورق", "قفاز",
    "डिब्बा", "थैला", "गिलास", "नैपकिन",
    "ڈبہ", "تھیلا", "گلاس", "نیپکن",
    "kahon", "supot", "baso"]],
];

const PALETTE = {
  produce: ["#16A34A", "#DCFCE7"],
  meat: ["#DC2626", "#FEE2E2"],
  dairy: ["#CA8A04", "#FEF9C3"],
  dry: ["#B45309", "#FEF3C7"],
  oil: ["#65A30D", "#ECFCCB"],
  drink: ["#0891B2", "#CFFAFE"],
  packaging: ["#6B7280", "#F3F4F6"],
};

export function categoryOf(name) {
  const text = String(name || "").toLowerCase();
  for (const [group, words] of GROUPS) {
    if (words.some((w) => text.includes(w))) return group;
  }
  return null;
}

/* A stable colour from the name, so an unmatched ingredient looks the same
   everywhere rather than shuffling between renders. */
function hueOf(name) {
  let h = 0;
  for (const ch of String(name || "")) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}

const SHAPES = {
  produce: <><circle cx="12" cy="13.5" r="6.5" /><path d="M12 7c0-2 1.5-3.5 3.5-3.5" fill="none" strokeWidth="1.8" /></>,
  meat: <><path d="M6 14c0-4 3-7 7-7s6 2.5 6 6-3 6-7 6-6-2-6-5z" /><circle cx="9.5" cy="14" r="1.6" fill="#fff" /></>,
  dairy: <><path d="M9 4h6l1 3.5v11a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 8 18.5v-11z" /></>,
  dry: <><path d="M5 18c1.5-6 4-9 7-9s5.5 3 7 9z" /><path d="M5 18h14" strokeWidth="2" /></>,
  oil: <><path d="M10 3h4v2.5l2 3v10a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 8 18.5v-10l2-3z" /></>,
  drink: <><path d="M7 5h10l-1.2 13.5a1.5 1.5 0 0 1-1.5 1.4H9.7a1.5 1.5 0 0 1-1.5-1.4z" /><path d="M8 10h8" strokeWidth="1.6" /></>,
  packaging: <><path d="M4 8l8-4 8 4v9l-8 4-8-4z" /><path d="M4 8l8 4 8-4M12 12v9" fill="none" strokeWidth="1.5" /></>,
};

export default function IngredientIcon({ name, size = 36 }) {
  const C = useC();
  const group = categoryOf(name);

  if (!group) {
    const hue = hueOf(name);
    const letter = String(name || "?").trim().charAt(0).toUpperCase() || "?";
    return (
      <div
        className="shrink-0 rounded-lg flex items-center justify-center font-bold"
        style={{
          width: size, height: size,
          background: `hsl(${hue} 70% 94%)`,
          color: `hsl(${hue} 55% 38%)`,
          fontSize: size * 0.42,
        }}
        aria-hidden="true"
      >
        {letter}
      </div>
    );
  }

  const [ink, wash] = PALETTE[group];
  return (
    <div
      className="shrink-0 rounded-lg flex items-center justify-center"
      style={{ width: size, height: size, background: wash }}
      aria-hidden="true"
    >
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24"
        fill={ink} stroke={ink} strokeLinejoin="round" strokeLinecap="round">
        {SHAPES[group]}
      </svg>
    </div>
  );
}
