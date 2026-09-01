/* Every string a screen reads has to exist in all five languages.

   Nothing else catches this. `t.sales.title` on a dictionary that has no
   `sales` block is `undefined`, and React renders `undefined` as nothing at
   all — so the screen loads, the build passes, the import checker passes, and
   an Arabic user gets a page with blank headings and unlabelled buttons. It
   fails silently, in one language, on a screen the person who added the strings
   was not looking at.

   English is the reference because it is the language every block is written
   in first. A key present in another language but missing from English is
   reported too: it is either a typo or a leftover, and both are worth seeing.

   Only the top two levels are compared. Going deeper would flag every legitimate
   difference in a nested list and the check would be switched off within a week.

   Run: node scripts/check-i18n.mjs
*/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(ROOT, "src", "i18n.jsx");
const REFERENCE = "en";

const src = fs.readFileSync(FILE, "utf8");
const lines = src.split("\n");

/* Each top-level language object, sliced out by brace depth. */
const langs = {};
lines.forEach((line, i) => {
  const m = line.match(/^ {2}([a-z]{2}): \{$/);
  if (!m) return;
  let depth = 0;
  for (let j = i; j < lines.length; j++) {
    depth += (lines[j].match(/\{/g) || []).length - (lines[j].match(/\}/g) || []).length;
    if (depth === 0) { langs[m[1]] = lines.slice(i, j + 1).join("\n"); return; }
  }
});

const langNames = Object.keys(langs);
if (!langNames.includes(REFERENCE)) {
  console.error(`  FAIL no "${REFERENCE}" dictionary to compare against`);
  process.exit(1);
}

/* Second-level block names, and the keys inside each. Indentation is the
   structure here — the file is hand-formatted at four and six spaces. */
function blocksOf(text) {
  const out = new Map();
  const rows = text.split("\n");

  const add = (name, keys) => {
    /* A block declared twice in one dictionary is a real hazard: the later one
       silently wins and every key unique to the first is dead. Merged here so
       the comparison does not chase ghosts; `duplicatesOf` reports them. */
    if (out.has(name)) for (const k of keys) out.get(name).add(k);
    else out.set(name, keys);
  };

  rows.forEach((row, i) => {
    /* Plenty of blocks are written on one line. Missing those made every
       language look like it had blocks English lacked. */
    const inline = row.match(/^ {4}(\w+): \{ (.*) \},?$/);
    if (inline) {
      add(inline[1], new Set([...inline[2].matchAll(/(\w+):/g)].map((k) => k[1])));
      return;
    }

    const m = row.match(/^ {4}(\w+): \{$/);
    if (!m) return;
    let depth = 0;
    for (let j = i; j < rows.length; j++) {
      depth += (rows[j].match(/\{/g) || []).length - (rows[j].match(/\}/g) || []).length;
      if (depth === 0) {
        const body = rows.slice(i, j + 1).join("\n");
        add(m[1], new Set([...body.matchAll(/^ {6}(\w+):/gm)].map((k) => k[1])));
        return;
      }
    }
  });
  return out;
}

/* Blocks declared more than once in the same dictionary. The later declaration
   wins outright, so every key unique to the earlier one is unreachable — the
   string is in the file, looks translated, and never renders. */
function duplicatesOf(text) {
  const seen = new Map();
  for (const row of text.split("\n")) {
    const m = row.match(/^ {4}(\w+): \{/);
    if (m) seen.set(m[1], (seen.get(m[1]) || 0) + 1);
  }
  return [...seen].filter(([, n]) => n > 1).map(([name]) => name);
}

const reference = blocksOf(langs[REFERENCE]);
const problems = [];
const warnings = [];

for (const lang of langNames) {
  for (const name of duplicatesOf(langs[lang])) {
    warnings.push(`${lang}: block "${name}" is declared more than once — the last one wins`);
  }
}

for (const lang of langNames) {
  if (lang === REFERENCE) continue;
  const blocks = blocksOf(langs[lang]);

  for (const [name, keys] of reference) {
    if (!blocks.has(name)) {
      problems.push(`${lang}: whole block "${name}" is missing`);
      continue;
    }
    const missing = [...keys].filter((k) => !blocks.get(name).has(k));
    if (missing.length) {
      problems.push(`${lang}.${name}: missing ${missing.join(", ")}`);
    }
  }

  for (const name of blocks.keys()) {
    if (!reference.has(name)) problems.push(`${lang}: block "${name}" has no ${REFERENCE} counterpart`);
  }
}

for (const w of warnings) console.warn(`  warn ${w}`);

if (problems.length) {
  for (const p of problems) console.error(`  FAIL ${p}`);
  console.error(`\n${problems.length} translation gap${problems.length === 1 ? "" : "s"}`);
  process.exit(1);
}

console.log(`  ok   ${reference.size} blocks present in all ${langNames.length} languages`);
console.log("\nall passed");
