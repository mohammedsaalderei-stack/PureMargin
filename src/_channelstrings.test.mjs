/* The channel strings live outside `i18n.jsx`, where `check-i18n.mjs`
   cannot see them. This is that check for them: every key English has,
   every other language has, and every value is a non-empty string — so a
   screen never shows a blank or a key name in Arabic, Hindi, Urdu or
   Filipino because a line was added in English only. */
import assert from "node:assert/strict";
import { CHANNEL_STRINGS } from "./i18n-channels.js";

const paths = (obj, prefix = "") => Object.entries(obj).flatMap(([k, v]) =>
  v && typeof v === "object" ? paths(v, `${prefix}${k}.`) : [`${prefix}${k}`]);
const get = (obj, path) => path.split(".").reduce((o, k) => (o ? o[k] : undefined), obj);

const english = paths(CHANNEL_STRINGS.en);
let failures = 0;
for (const lang of ["ar", "hi", "ur", "tl"]) {
  const missing = english.filter((p) => typeof get(CHANNEL_STRINGS[lang], p) !== "string" || !get(CHANNEL_STRINGS[lang], p).trim());
  const extra = paths(CHANNEL_STRINGS[lang]).filter((p) => get(CHANNEL_STRINGS.en, p) === undefined);
  try {
    assert.deepEqual(missing, [], `${lang} is missing ${missing.length}: ${missing.slice(0, 8).join(", ")}`);
    assert.deepEqual(extra, [], `${lang} has keys English doesn't: ${extra.slice(0, 8).join(", ")}`);
    console.log("  ok ", `${lang}: all ${english.length} channel strings`);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", err.message);
  }
}
/* Placeholders survive translation: a {name} in English is a {name} in every language. */
for (const lang of ["ar", "hi", "ur", "tl"]) {
  for (const p of english) {
    const want = (get(CHANNEL_STRINGS.en, p).match(/\{\w+\}/g) || []).sort().join();
    const got = (String(get(CHANNEL_STRINGS[lang], p) || "").match(/\{\w+\}/g) || []).sort().join();
    if (want !== got) { failures += 1; console.error("  FAIL", `${lang}.${p} placeholders ${got || "none"} ≠ ${want}`); }
  }
}
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
