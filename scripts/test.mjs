/* The test runner.

   This used to be a single npm script: every test file named by hand, joined
   with `&&`, each one prefixed `REDIS_URL= KV_URL= KV_REST_API_URL=` to force
   the memory store. Sixteen hundred characters on one line. It had two faults,
   and both had already cost something.

   1. **The list was maintained by hand, and drifted.** A merge kept both sides
      of that line and the older one silently won, so `_varcosts`, `_saleedits`
      and `_packages` existed, passed, and were never run — while two files the
      list still named had been deleted. Discovering test files removes the
      class of mistake rather than fixing the instance: a new `*.test.js` is
      picked up by existing.
   2. **`VAR= command` is POSIX.** npm runs scripts through `cmd.exe` on
      Windows, which reads `REDIS_URL=` as a program name and stops. The suite
      could not be run on Windows at all. Setting the variables in the child's
      environment here works the same on every platform, with no dependency.

   The memory store is not a convenience. `_store.js` picks its backend from
   these three variables at import, and the tests write fixture accounts through
   it — pointed at a real Redis they would write test data into live records.
   Blanking the variables for the child process is what makes that impossible,
   so it happens here, once, for every file, rather than being repeated per
   entry in a list somebody has to remember to copy.

   Run: node scripts/test.mjs [substring ...]
   A substring narrows the run to matching files — `node scripts/test.mjs units`
   while working on units, the whole suite before pushing. */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* Where test files live, and what they look like. Both directories are listed
   rather than walked from the root: `node_modules` contains thousands of test
   files belonging to other people. */
const DIRS = ["api", "src"];
const IS_TEST = /\.test\.(js|mjs)$/;

const filters = process.argv.slice(2);

const files = DIRS
  .flatMap((dir) => {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) return [];
    return fs.readdirSync(full)
      .filter((name) => IS_TEST.test(name))
      .map((name) => `${dir}/${name}`);
  })
  .filter((file) => !filters.length || filters.some((f) => file.includes(f)))
  .sort();

if (!files.length) {
  console.error(filters.length
    ? `no test files match ${filters.join(", ")}`
    : "no test files found");
  process.exit(1);
}

/* The child environment, with every storage backend unset.

   `delete` rather than `= ""`: an empty string is falsy, so `_store.js` would
   reach the same conclusion either way, but an unset variable is the honest
   statement of "there is no Redis here" and survives anything that checks for
   presence rather than truth. */
const env = { ...process.env };
delete env.REDIS_URL;
delete env.KV_URL;
delete env.KV_REST_API_URL;
delete env.KV_REST_API_TOKEN;

const run = (file) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [file], {
      cwd: ROOT,
      env,
      stdio: "inherit",
    });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });

let failed = 0;
for (const file of files) {
  const code = await run(file);
  if (code !== 0) {
    failed += 1;
    /* Stop at the first failure. The old `&&` chain did, and it is the right
       behaviour: a broken shared module fails twenty files, and the twentieth
       message is no more useful than the first. */
    console.error(`\n  FAIL ${file} exited ${code}`);
    break;
  }
}

if (failed) process.exit(1);
console.log(`\n  ok   ${files.length} test files passed`);
