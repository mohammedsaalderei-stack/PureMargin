/* Every screen owns its own scroll container.

   The shell renders screens inside a <main> that is `overflow-hidden`, so a
   screen taller than the viewport is simply cut off — no scrollbar, no
   indication, the page just ends. Five screens had no container of their own.
   That was survivable while their content happened to fit, and stopped being
   survivable the moment a scanner added a result panel below the fold: the
   save button existed and could not be reached.

   Nothing else here catches it. The file parses, the imports resolve, the
   component renders, and the failure is a CSS property that is absent rather
   than wrong.

   Run: node scripts/check-scroll.mjs
*/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "src", "screens");

const missing = [];
for (const name of fs.readdirSync(DIR).filter((f) => f.endsWith(".jsx"))) {
  const src = fs.readFileSync(path.join(DIR, name), "utf8");
  if (!/overflow-y-auto|overflow-auto|overflow-y-scroll/.test(src)) missing.push(name);
}

if (missing.length) {
  for (const name of missing) {
    console.error(`  FAIL src/screens/${name}: no scroll container — content below the fold is unreachable`);
  }
  console.error(`\n${missing.length} screen${missing.length === 1 ? "" : "s"} cannot scroll`);
  process.exit(1);
}

console.log(`  ok   every screen has a scroll container`);
console.log("\nall passed");
