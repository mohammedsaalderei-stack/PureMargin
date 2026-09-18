/* Every tab the server can permit has an icon and a screen.

   ── The bug this exists for ──────────────────────────────────────────────

   Attendance was added to `TAB_ACCESS` on the server and to the nav list in
   Shell, and not to `TAB_ICONS` — a second, hand-written map of the same
   thing. The drawer looks its icon up there, found undefined, and rendered
   `<undefined />`: React error #130, the screen replaced by an error card.

   It only broke on a phone. The desktop rail reads the icon off the tab object
   and never touches the map, so the app looked healthy on the machine it was
   built on and was unusable on the device it is actually used on.

   `MobileShell` carries a comment about the same thing happening before, with
   a hand-written list of five primary tabs that went stale and left Bill scan
   unreachable on a phone. The lists have been collapsed into one now, and this
   is here so a future second list is caught by a build rather than by somebody
   holding a phone.

   Three things must line up for a tab to work, and they live in three files:

     api/_tabs.js    may this role open it
     src/Shell.jsx   what it looks like in the nav, and which screen it renders
     src/i18n.jsx    what it is called, in five languages

   Run: node scripts/check-tabs.mjs
*/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

/* Tabs the server will hand out. Read from the source rather than imported:
   `api/_tabs.js` pulls in the role table, and a checker that boots half the
   server to count strings is a checker that breaks for unrelated reasons. */
const tabsSrc = read("api/_tabs.js");
const accessBlock = tabsSrc.slice(
  tabsSrc.indexOf("export const TAB_ACCESS = {"),
  tabsSrc.indexOf("export const TAB_KEYS"),
);
const permitted = [...accessBlock.matchAll(/^\s{2}([a-z_]+):\s/gm)].map((m) => m[1]);

const shell = read("src/Shell.jsx");

/* The one ordered list the nav and the icon map are both built from. */
const allTabs = shell.slice(shell.indexOf("const ALL_TABS = (() => {"), shell.indexOf("const TAB_ICONS"));

/* Which ids that list actually contains, whether written directly in TAB_META
   or appended as a named constant. */
const named = new Set();
for (const m of shell.matchAll(/const\s+([A-Z_]+_TAB)\s*=\s*\{\s*id:\s*"([a-z_]+)"/g)) {
  if (allTabs.includes(m[1])) named.add(m[2]);
}
for (const m of allTabs.matchAll(/byId\.([a-z_]+)/g)) named.add(m[1]);

const problems = [];

for (const id of permitted) {
  if (!named.has(id)) {
    problems.push(`${id}: permitted by api/_tabs.js but missing from ALL_TABS in src/Shell.jsx — the drawer would render an undefined icon`);
  }
  /* The screen it opens. Without this the tab is reachable and blank. */
  if (!new RegExp(`tab === "${id}"`).test(shell)) {
    problems.push(`${id}: no screen wired in src/Shell.jsx — the tab opens onto nothing`);
  }
}

/* And a name, in every language, or the nav falls back to the raw id. */
const i18n = read("src/i18n.jsx").split(/\r?\n/);
const langs = [];
{
  let lang = null;
  let section = null;
  const seen = new Map();
  for (const line of i18n) {
    const L = /^ {2}([a-z]{2}): \{/.exec(line);
    if (L) { lang = L[1]; seen.set(lang, new Set()); langs.push(lang); }
    const S = /^ {4}([a-zA-Z]+): \{/.exec(line);
    if (S) section = S[1];
    if (lang && section && /^ {6}tab: /.test(line)) seen.get(lang).add(section);
  }
  for (const id of permitted) {
    for (const lang of langs) {
      if (!seen.get(lang)?.has(id)) {
        problems.push(`${id}: no ${lang}.${id}.tab in src/i18n.jsx — the nav would show the raw id`);
      }
    }
  }
}

if (problems.length) {
  for (const p of problems) console.error(`  FAIL ${p}`);
  console.error(`\n${problems.length} tab problem${problems.length === 1 ? "" : "s"}`);
  process.exit(1);
}

console.log(`  ok   ${permitted.length} tabs: each has an icon, a screen and a name in ${langs.length} languages`);
