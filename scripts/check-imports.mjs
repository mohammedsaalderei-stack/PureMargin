/* Catches the class of bug that broke the Plan tab.

   Six components called fill() while importing only useLang from i18n.jsx.
   Modules don't inherit their parent's imports, so fill was an unresolved
   global and threw ReferenceError the moment the component rendered. Nothing
   in the build catches it: Vite compiles a bare identifier to a global lookup
   that only fails at runtime, and the screen looked fine until real data
   reached it.

   Three checks, no dependencies, so it runs anywhere node does:

     1. every relative import resolves to a file that exists
     2. every named import is actually exported by that file
     3. no call site uses a name that some module in this project exports
        unless this file imports or declares it

   Check 3 is the one that matters. It's deliberately narrow — it only fires
   on names the project itself exports somewhere, so a typo'd browser global
   slips through, but it cannot cry wolf about ordinary local variables. A
   checker that fails the build on noise gets switched off.

   Run: node scripts/check-imports.mjs
*/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN = ["src", "api"];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.jsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/* Comments and literals are stripped before any identifier scanning, so a name
   mentioned in a comment or inside a string is never mistaken for a call. */
function strip(t) {
  return t
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(?<![:\w])\/\/[^\n]*/g, " ")
    .replace(/`(?:\\.|[^`\\])*`/gs, "``")
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

const IMPORT = /import\s+([^;]*?)\s+from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/gs;

function imports(text) {
  const out = [];
  for (const m of text.matchAll(IMPORT)) {
    if (m[3]) out.push({ clause: "", spec: m[3] });
    else out.push({ clause: m[1], spec: m[2] });
  }
  return out;
}

function parseClause(clause) {
  const defaults = [];
  const named = [];
  const ns = [];
  let c = clause.trim();
  for (const m of c.matchAll(/\*\s+as\s+(\w+)/g)) ns.push(m[1]);
  c = c.replace(/\*\s+as\s+\w+/g, "");
  const brace = c.match(/\{([\s\S]*?)\}/);
  if (brace) {
    for (let part of brace[1].split(",")) {
      part = part.trim();
      if (!part) continue;
      const as = part.match(/^(\w+)\s+as\s+(\w+)$/);
      if (as) named.push([as[1], as[2]]);
      else if (/^\w+$/.test(part)) named.push([part, part]);
    }
    c = c.slice(0, brace.index) + c.slice(brace.index + brace[0].length);
  }
  for (let part of c.split(",")) {
    part = part.trim();
    if (/^\w+$/.test(part)) defaults.push(part);
  }
  return { defaults, named, ns };
}

const files = SCAN.flatMap((d) => walk(path.join(ROOT, d)));
const src = new Map(files.map((f) => [f, fs.readFileSync(f, "utf8")]));

/* what each file exports */
const exportsOf = new Map();
for (const [f, raw] of src) {
  const t = strip(raw);
  const names = new Set();
  for (const m of t.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+(\w+)/g)) {
    names.add(m[1]);
  }
  for (const m of t.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (let part of m[1].split(",")) {
      part = part.trim();
      const as = part.match(/^\w+\s+as\s+(\w+)$/);
      if (as) names.add(as[1]);
      else if (/^\w+$/.test(part)) names.add(part);
    }
  }
  exportsOf.set(f, { named: names, def: /export\s+default/.test(t) });
}

const provider = new Set();
for (const { named } of exportsOf.values()) for (const n of named) provider.add(n);

function resolve(from, spec) {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [base, base + ".js", base + ".jsx",
                   path.join(base, "index.js"), path.join(base, "index.jsx")]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return false;
}

const RESERVED = new Set(`if else for while return function const let var new typeof instanceof in of do switch
case break continue class extends super this null true false undefined void delete yield await async try catch
finally throw import export default String Number Boolean Array Object Math JSON Date RegExp Promise Map Set
WeakMap WeakSet Symbol Error TypeError RangeError console window document navigator location history
localStorage sessionStorage fetch setTimeout setInterval clearTimeout clearInterval requestAnimationFrame
cancelAnimationFrame URL URLSearchParams Blob FormData Intl process Buffer crypto parseInt parseFloat isNaN
isFinite encodeURIComponent decodeURIComponent structuredClone AbortController TextEncoder TextDecoder
Uint8Array ArrayBuffer BigInt Proxy Reflect globalThis alert confirm prompt File FileReader Image Response
Request Headers CustomEvent Event EventSource WebSocket IntersectionObserver ResizeObserver MutationObserver
performance queueMicrotask atob btoa DOMParser XMLSerializer require module exports`.split(/\s+/));

const problems = [];

for (const [f, raw] of src) {
  const t = strip(raw);
  const local = new Set();

  for (const { clause, spec } of imports(raw)) {
    const { defaults, named, ns } = parseClause(clause);
    for (const n of [...defaults, ...ns]) local.add(n);
    for (const [, loc] of named) local.add(loc);

    const target = resolve(f, spec);
    if (target === false) {
      problems.push([f, `import does not resolve: ${spec}`]);
    } else if (target && exportsOf.has(target)) {
      const te = exportsOf.get(target);
      for (const [orig] of named) {
        if (!te.named.has(orig)) {
          problems.push([f, `${spec} does not export "${orig}"`]);
        }
      }
      if (defaults.length && !te.def) {
        problems.push([f, `${spec} has no default export`]);
      }
    }
  }

  /* Locally bound names. Deliberately generous: over-collecting here only
     costs a missed warning, while under-collecting would produce false
     failures on ordinary code. */
  const add = (re, g = 1) => { for (const m of t.matchAll(re)) if (m[g]) local.add(m[g]); };
  add(/\b(?:const|let|var)\s+(\w+)/g);
  add(/\bfunction\s*\*?\s*(\w+)/g);
  add(/\bclass\s+(\w+)/g);
  add(/catch\s*\(\s*(\w+)/g);
  add(/\b(\w+)\s*=>/g);
  for (const m of t.matchAll(/(?:const|let|var)\s*\{([^{}]*)\}/g)) {
    for (let p of m[1].split(",")) {
      p = p.trim();
      const as = p.match(/^\w+\s*:\s*(\w+)/);
      const nm = p.match(/^(\w+)/);
      if (as) local.add(as[1]); else if (nm) local.add(nm[1]);
    }
  }
  for (const m of t.matchAll(/(?:const|let|var)\s*\[([^\]]*)\]/g)) {
    for (const p of m[1].split(",")) {
      const nm = p.trim().match(/^(\w+)/);
      if (nm) local.add(nm[1]);
    }
  }
  for (const m of t.matchAll(/\(([^()]{0,400}?)\)\s*=>/g)) {
    for (const p of m[1].split(",")) {
      const nm = p.trim().match(/^\{?\s*(\w+)/);
      if (nm) local.add(nm[1]);
    }
  }
  for (const m of t.matchAll(/function\s*\*?\s*\w*\s*\(([^()]*)\)/g)) {
    for (const p of m[1].split(",")) {
      const nm = p.trim().match(/^\{?\s*(\w+)/);
      if (nm) local.add(nm[1]);
    }
  }
  for (const m of t.matchAll(/\(\s*\{([^{}]*)\}\s*(?:=[^)]*)?\)\s*(?:=>|\{)/g)) {
    for (let p of m[1].split(",")) {
      p = p.trim();
      const as = p.match(/^\w+\s*:\s*(\w+)/);
      const nm = p.match(/^(\w+)/);
      if (as) local.add(as[1]); else if (nm) local.add(nm[1]);
    }
  }

  const seen = new Set();
  for (const m of t.matchAll(/(?<![\w.$])([a-zA-Z_$][\w$]*)\s*\(/g)) {
    const name = m[1];
    if (RESERVED.has(name) || local.has(name) || seen.has(name)) continue;
    if (provider.has(name)) {
      seen.add(name);
      const line = t.slice(0, m.index).split("\n").length;
      problems.push([f, `"${name}" is used but never imported or declared (line ${line})`]);
    }
  }
}

if (problems.length) {
  for (const [f, msg] of problems) {
    console.error(`  FAIL ${path.relative(ROOT, f)}: ${msg}`);
  }
  console.error(`\n${problems.length} problem${problems.length === 1 ? "" : "s"} found`);
  process.exit(1);
}

console.log(`  ok   ${src.size} files, imports all resolve`);
console.log("\nall passed");
