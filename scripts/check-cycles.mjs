/* Circular imports.

   A cycle in ESM is legal and usually harmless, right up until one module in
   the ring reads another's binding while that module is still evaluating. Then
   the binding is in its temporal dead zone and the whole screen dies with
   "Cannot access 'x' before initialization" — and because the bundler has
   renamed everything by then, the 'x' in the message is a minified name that
   appears nowhere in the source, which is why these are miserable to chase.

   The safest rule is simply not to have cycles. This finds them.

   Run: node scripts/check-cycles.mjs
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

function strip(t) {
  return t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(?<![:\w])\/\/[^\n]*/g, " ");
}

function resolve(from, spec) {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [base, base + ".js", base + ".jsx",
                   path.join(base, "index.js"), path.join(base, "index.jsx")]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

const files = SCAN.flatMap((d) => walk(path.join(ROOT, d)));
const graph = new Map();

for (const f of files) {
  const t = strip(fs.readFileSync(f, "utf8"));
  const deps = new Set();
  for (const m of t.matchAll(/import\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["']/g)) {
    const target = resolve(f, m[1]);
    if (target) deps.add(target);
  }
  /* Dynamic import() joins the ring too, and is a common way a cycle sneaks
     back in after someone breaks it. */
  for (const m of t.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    const target = resolve(f, m[1]);
    if (target) deps.add(target);
  }
  graph.set(f, [...deps]);
}

const cycles = [];
const state = new Map();   // file -> "visiting" | "done"
const stack = [];

function visit(node) {
  const s = state.get(node);
  if (s === "done") return;
  if (s === "visiting") {
    const at = stack.indexOf(node);
    if (at !== -1) cycles.push([...stack.slice(at), node]);
    return;
  }
  state.set(node, "visiting");
  stack.push(node);
  for (const dep of graph.get(node) || []) visit(dep);
  stack.pop();
  state.set(node, "done");
}

for (const f of files) visit(f);

/* The same ring can be found from several entry points; keep one of each. */
const seen = new Set();
const unique = [];
for (const cycle of cycles) {
  const key = [...cycle.slice(0, -1)].sort().join("|");
  if (seen.has(key)) continue;
  seen.add(key);
  unique.push(cycle);
}

if (unique.length) {
  for (const cycle of unique) {
    console.error("  FAIL circular import:");
    console.error("       " + cycle.map((f) => path.relative(ROOT, f)).join("\n         -> "));
  }
  console.error(`\n${unique.length} cycle${unique.length === 1 ? "" : "s"} found`);
  process.exit(1);
}

console.log(`  ok   ${files.length} files, no circular imports`);
console.log("\nall passed");
