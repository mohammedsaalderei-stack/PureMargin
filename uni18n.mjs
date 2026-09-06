import fs from "node:fs";
const p = "src/i18n.jsx";
const lines = fs.readFileSync(p, "utf8").split("\n");

const L = {
  en: { mg:"mg", g:"g", kg:"kg", oz:"oz", lb:"lb", ml:"ml", cl:"cl", l:"L",
        tsp:"tsp", tbsp:"tbsp", cup:"cup", floz:"fl oz", gal:"gal", ea:"each", dozen:"dozen" },
  ar: { mg:"مجم", g:"جم", kg:"كجم", oz:"أونصة", lb:"رطل", ml:"مل", cl:"سم٣", l:"لتر",
        tsp:"ملعقة صغيرة", tbsp:"ملعقة كبيرة", cup:"كوب", floz:"أونصة سائلة", gal:"جالون",
        ea:"حبة", dozen:"دزينة" },
  hi: { mg:"मिग्रा", g:"ग्राम", kg:"किग्रा", oz:"औंस", lb:"पाउंड", ml:"मिली", cl:"सेमी³", l:"लीटर",
        tsp:"छोटा चम्मच", tbsp:"बड़ा चम्मच", cup:"कप", floz:"फ्लूइड औंस", gal:"गैलन",
        ea:"नग", dozen:"दर्जन" },
  ur: { mg:"ملی گرام", g:"گرام", kg:"کلوگرام", oz:"اونس", lb:"پاؤنڈ", ml:"ملی لیٹر", cl:"سینٹی لیٹر", l:"لیٹر",
        tsp:"چھوٹا چمچ", tbsp:"بڑا چمچ", cup:"کپ", floz:"فلوئد اونس", gal:"گیلن",
        ea:"عدد", dozen:"درجن" },
  tl: { mg:"mg", g:"g", kg:"kg", oz:"onsa", lb:"libra", ml:"ml", cl:"cl", l:"L",
        tsp:"kutsarita", tbsp:"kutsara", cup:"tasa", floz:"fl oz", gal:"galon",
        ea:"piraso", dozen:"dosena" },
};

const ORDER = ["en", "ar", "hi", "ur", "tl"];
let langIdx = -1, out = [], done = 0;
for (const line of lines) {
  if (/^  [a-z]{2}: \{/.test(line)) langIdx += 1;
  out.push(line);
  /* Anchor on the aiscan block, which every dictionary has exactly once. */
  if (/^    aiscan: \{$/.test(line)) {
    const map = L[ORDER[langIdx]];
    out.pop();
    out.push("    /* Unit names as a person reads them. The keys are the ledger's own —");
    out.push("       the value sent to the API is always the key — and these are only how");
    out.push("       each one is written on screen. */");
    out.push("    unitNames: {");
    for (const [k, v] of Object.entries(map)) out.push(`      ${k}: ${JSON.stringify(v)},`);
    out.push("    },");
    out.push(line);
    done += 1;
  }
}
if (done !== 5) { console.error("expected 5 dictionaries, patched", done); process.exit(1); }
fs.writeFileSync(p, out.join("\n"));
console.log("unitNames added to all 5 dictionaries");
