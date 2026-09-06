import fs from "node:fs";
const p = "api/_purchase.js";
const lines = fs.readFileSync(p, "utf8").split("\n");

/* Replace the norm block, from "const norm = (s) =>" to its terminating line. */
const start = lines.findIndex((l) => l.startsWith("const norm = (s) =>"));
if (start === -1) { console.error("norm start missing"); process.exit(1); }
let end = start;
while (end < lines.length && !lines[end].includes('.replace(/\s+/g, " ");')) end += 1;
if (end >= lines.length) { console.error("norm end missing"); process.exit(1); }

lines.splice(start, end - start + 1,
  "/* One normaliser for the whole app, in _text.js. It lived here too, and the",
  "   two copies drifted: the unit reader folded Arabic letter forms and this one",
  '   did not, so "حبه" resolved as a unit while "زبده" failed to find "زبدة" on',
  "   the shelf. */",
  "const norm = normaliseText;");

let t = lines.join("\n");

const oldTokens = 'const tokens = (s) =>\n  new Set(norm(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2).map(stem));';
if (!t.includes(oldTokens)) { console.error("tokens block not found"); process.exit(1); }
t = t.replace(oldTokens, "const tokens = (s) => new Set(words(s).filter((w) => w.length > 2).map(stem));");

t = t.replace('import { sameDimension, unitLabel } from "./_units.js";',
  'import { sameDimension, unitLabel } from "./_units.js";\nimport { normaliseText, words } from "./_text.js";');

const oldBest = `  let winner = null;
  let best = 0;
  for (const ing of ingredients) {
    const s = score(text, ing.name);
    if (s > best) { best = s; winner = ing; }
  }`;
if (!t.includes(oldBest)) { console.error("bestMatch body not found"); process.exit(1); }
t = t.replace(oldBest, `  let winner = null;
  let best = 0;
  for (const ing of ingredients) {
    /* The name, and every other name it is known by. An alias is a whole
       separate name rather than extra words on the existing one — scoring
       "Ground beef لحم مفروم" as one string would dilute both, so each is
       scored on its own and the best one stands. */
    for (const candidate of [ing.name, ...(ing.aliases || [])]) {
      const s = score(text, candidate);
      if (s > best) { best = s; winner = ing; }
    }
  }`);

fs.writeFileSync(p, t);
console.log("matcher reads aliases and shares the normaliser");
