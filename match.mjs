import fs from "node:fs";
const p = "api/_purchase.js";
let t = fs.readFileSync(p, "utf8");

/* Replace the local normaliser with the shared one. */
const oldNorm = t.match(/const norm = \(s\) =>[\s\S]*?\.replace\(\/\s\+\/g, " "\);/);
if (!oldNorm) { console.error("norm block not found"); process.exit(1); }
t = t.replace(oldNorm[0], `/* One normaliser for the whole app, in _text.js. It lived here as well, and
   the two copies drifted: the unit reader folded Arabic letter forms and this
   did not, so "حبه" resolved as a unit while "زبده" failed to find "زبدة" on
   the shelf. */
const norm = normaliseText;`);

/* Tokens come from the shared splitter. */
const oldTokens = `const tokens = (s) =>
  new Set(norm(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2).map(stem));`;
if (!t.includes(oldTokens)) { console.error("tokens block not found"); process.exit(1); }
t = t.replace(oldTokens, `const tokens = (s) => new Set(words(s).filter((w) => w.length > 2).map(stem));`);

t = t.replace('import { sameDimension, unitLabel } from "./_units.js";',
  'import { sameDimension, unitLabel } from "./_units.js";\nimport { normaliseText, words } from "./_text.js";');

/* Score against the name and every alias, taking the best. */
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
    /* The name and every other name it is known by. An alias is a whole
       separate name rather than extra words on the existing one — scoring
       "Ground beef لحم مفروم" as one string would dilute both, so each is
       scored on its own and the best one stands. */
    for (const candidate of [ing.name, ...(ing.aliases || [])]) {
      const s = score(text, candidate);
      if (s > best) { best = s; winner = ing; }
    }
  }`);

fs.writeFileSync(p, t);
console.log("matcher now reads aliases and shares the normaliser");
