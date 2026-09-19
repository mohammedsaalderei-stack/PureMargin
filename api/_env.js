import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* Read a local .env, for the things that run outside a deployment.

   Vercel injects environment variables into a function; nothing injects them
   into `node scripts/migrate.mjs` or into a test on somebody's laptop. This is
   the six lines that close that gap, in one place rather than copied into each
   script that needs it.

   Deliberately not `dotenv`. It is a production dependency for the sake of
   code that never runs in production, and the whole of what is wanted is here.

   Anything already set wins. A deployment's real configuration is never
   overwritten by a file somebody left on disk, and an explicit
   `DATABASE_URL=... node script.js` beats both. */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadLocalEnv(root = ROOT) {
  for (const name of [".env.local", ".env"]) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;

    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const key = m[1];
      let value = m[2].trim();
      if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1);
      if (process.env[key] === undefined && value !== "") process.env[key] = value;
    }
  }
}
