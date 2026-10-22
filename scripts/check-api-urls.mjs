/* Nobody hardcodes the API's host into a screen.

   `src/platform.js` exists so that the app can go on writing
   `fetch("/api/metrics")` everywhere and have it reach the right place on the
   web and inside the iOS app. That only holds while every call site is
   relative. One absolute URL written in a hurry —

       fetch("https://puremargin.ae/api/metrics")

   — works perfectly in every browser, in every test, and in the simulator,
   and is wrong in exactly two situations nobody tests: a staging build that
   should be talking to a staging API, and the day the domain changes. It
   would also quietly send a bearer token to a hardcoded host.

   So the rule is checked rather than remembered, in the same way the tabs and
   the translations are. The adapter itself is allowed to name the default,
   because naming it is its job.

   Run: node scripts/check-api-urls.mjs */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");

/* The one file whose purpose is to hold the origin. */
const ALLOWED = new Set(["platform.js"]);

/* Any absolute http(s) URL whose path begins /api. The host is not named:
   `https://staging.puremargin.ae/api/x` is the same mistake, and so is a URL
   pointing at somebody else's API entirely. */
const ABSOLUTE_API = /https?:\/\/[^\s"'`)]+\/api(\/|\?|["'`\s]|$)/g;

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(jsx?|mjs)$/.test(entry.name) && !/\.test\.(js|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const problems = [];
let scanned = 0;

for (const file of walk(SRC)) {
  const rel = path.relative(SRC, file).split(path.sep).join("/");
  if (ALLOWED.has(rel)) continue;
  scanned += 1;

  const text = fs.readFileSync(file, "utf8");
  text.split(/\r?\n/).forEach((line, i) => {
    /* A comment explaining the rule is not a breach of it.

       The lookbehind is load-bearing and was missing at first: `//` also
       appears in the middle of every URL this is looking for, so stripping
       from the first one swallowed `https://…/api/…` entirely and the check
       passed on a file written specifically to fail it. Matching only a `//`
       not preceded by a colon leaves the scheme alone. */
    const code = line.replace(/(?<!:)\/\/.*$/, "").replace(/^\s*\*.*$/, "");
    for (const m of code.matchAll(ABSOLUTE_API)) {
      problems.push({ file: `src/${rel}`, line: i + 1, text: m[0] });
    }
  });
}

if (problems.length) {
  console.error(`\n  ${problems.length} absolute API URL(s) in src/:\n`);
  for (const p of problems) console.error(`    ${p.file}:${p.line}  ${p.text}`);
  console.error(
    "\n  Use a relative path — fetch(\"/api/…\"). src/platform.js points it at"
    + "\n  the right origin on the web and inside the iOS app.\n",
  );
  process.exit(1);
}

console.log(`  ok   ${scanned} source files, no hardcoded API hosts`);
