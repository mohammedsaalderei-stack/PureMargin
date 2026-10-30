/* Where accounts and conversations live.
   Serverless functions keep nothing between invocations, so this has to be
   external. Three backends are supported, picked automatically:

   1. REDIS_URL          — Redis Cloud and most other providers (TCP)
   2. KV_REST_API_URL    — Upstash and anything else speaking its HTTP API
   3. in-process Map     — local development only; lost on every cold start

   Both real backends are equally fine for this app. TCP needs the `redis`
   package and holds a connection open between invocations; HTTP needs no
   package and no connection at all, which suits serverless slightly better
   under bursty traffic. Whichever is attached, the rest of the code is
   unchanged. */

const REST_URL = process.env.KV_REST_API_URL;
const REST_TOKEN = process.env.KV_REST_API_TOKEN;
const TCP_URL = process.env.REDIS_URL || process.env.KV_URL;
const PG_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;

/* Postgres first, when there is one.

   Not a preference about databases. The provider deleted the production
   Redis on 17-Oct-2026 — free tier, reclaimed after a fortnight idle, no
   persistence, no backup, nothing to restore — and the replacement sits on
   the same plan with the same settings. Everything this module holds is
   durable application state: accounts, organizations, the item master, the
   stock ledgers, recipes, purchase orders, attendance. None of it is a
   cache. The POS read, which is the only high-volume thing in the app, is
   an in-process Map in `_data.js` and never comes near here.

   So when both are configured Postgres wins outright rather than the two
   sharing the work, because a key with two homes is a key with two answers
   and no way to tell which is current. Redis stays supported for a
   deployment that has one and no database. */
export let backend = PG_URL
  ? "pg"
  : REST_URL && REST_TOKEN ? "http" : TCP_URL ? "tcp" : "memory";
export let persistent = backend !== "memory";

/* Test seam: keep this module on memory even though a database is configured.

   `scripts/test.mjs` deletes DATABASE_URL from the child environment, so the
   suite cannot reach the live store by accident. But a test file that needs
   the database for its own sake calls `loadLocalEnv()` to get it back — and
   that one variable now decides this module's backend too, so `_mirror.test.js`
   quietly began writing its olive-oil fixtures into the production `kv` table
   the moment Postgres was preferred here. Two rows, with a random organization
   id, which nothing would ever have cleaned up or recognised.

   An environment variable would be the obvious fix and is the wrong one: a
   variable that forces memory is a variable that can be set in production,
   and discarding every write while reporting success is precisely the failure
   this file spent a commit removing. A function has to be called on purpose,
   by a file that has already decided it is a test, which is why this is one. */
export function __forceMemory() {
  backend = "memory";
  persistent = false;
}

/* ── When the store is configured and cannot be reached ──────────────

   Every operation below used to swallow its error: a failed read returned
   null, a failed write returned false, a failed scan returned []. Null is
   also what a missing key returns, so a database that had gone away was
   indistinguishable from an empty one — and nothing in the codebase checks
   the boolean a write returns.

   That lied in the most expensive direction available. Sign-in read as
   "wrong password", because `requireAuth` could not tell "no such account"
   from "could not ask". Every stock balance read as zero. And a delivery
   typed in at seven in the morning returned 200 and went nowhere, because
   the fall-through at the bottom of each function put it in a per-invocation
   Map that dies with the request.

   So a configured backend that fails now throws, and the in-memory Map is
   reachable only when no backend is configured at all — local development,
   where losing it on restart is the documented behaviour. A request that
   fails is a request somebody retries. A request that quietly succeeds is a
   number nobody questions. */
export class StorageUnavailable extends Error {
  constructor(operation, cause) {
    super(`storage unavailable (${operation}): ${cause?.message || cause}`);
    this.name = "StorageUnavailable";
    this.operation = operation;
    this.cause = cause;
  }
}

async function guard(operation, fn) {
  try {
    return await fn();
  } catch (err) {
    if (err?.name === "StorageUnavailable") throw err;
    console.error(`[sufra] ${operation} failed: ${err.message}`);
    throw new StorageUnavailable(operation, err);
  }
}

/* Checked by name rather than `instanceof`, so it still answers correctly if
   two copies of this module are ever loaded — a bundler, or a dynamic import
   under a different specifier — and the class identities differ. */
export const unavailable = (err) => err?.name === "StorageUnavailable";

/* The HTTP meaning of it, kept beside the error so no route can invent a
   different status for the same condition. 503 rather than 500: the request
   was fine and will work when the store is back, which is also what tells a
   client it is worth retrying. */
export function handledUnavailable(res, err) {
  if (!unavailable(err)) return false;
  res.setHeader("Retry-After", "30");
  res.status(503).json({ error: "storage" });
  return true;
}

const memory = new Map();
let warned = false;

function warnOnce() {
  if (warned || persistent) return;
  warned = true;
  console.warn(
    "[sufra] No storage configured. Accounts and conversations are being held " +
      "in memory and will be lost on the next cold start. Attach Redis and set " +
      "either REDIS_URL, or KV_REST_API_URL with KV_REST_API_TOKEN."
  );
}

/* ---------------- TCP (Redis Cloud, node-redis) ---------------- */
/* One client per warm instance. Connecting on every call would be slower
   than the query itself and would exhaust the connection limit. */
let clientPromise = null;

async function tcpClient() {
  if (clientPromise) return clientPromise;

  clientPromise = (async () => {
    let createClient;
    try {
      ({ createClient } = await import("redis"));
    } catch {
      // Package missing — fall back rather than take the whole request down.
      console.error("[sufra] REDIS_URL is set but the `redis` package isn't installed.");
      return null;
    }

    const client = createClient({
      url: TCP_URL,
      socket: { reconnectStrategy: (tries) => (tries > 5 ? false : Math.min(tries * 100, 1000)) },
    });
    client.on("error", (err) => console.error("[sufra] Redis error:", err.message));
    await client.connect();
    return client;
  })();

  const resolved = await clientPromise;
  // A failed connect shouldn't be cached forever; let the next call retry.
  if (!resolved) clientPromise = null;
  return resolved;
}

/* ---------------- Postgres (the kv table from migration 004) ---------------- */
/* Imported where it is used rather than at the top, so a deployment with no
   database never loads `pg` at all, and so this module does not depend on
   `_db.js` to be read. */
async function pg(text, params) {
  const { db } = await import("./_db.js");
  return db().query(text, params);
}

/* `%` and `_` are LIKE wildcards and `\` escapes them, so a prefix carrying
   one would match more keys than it named. None of the prefixes in use do
   today — but "today" is not a property worth relying on when the cost of
   being wrong is an admin screen listing somebody else's records. */
const likePrefix = (prefix) => `${String(prefix).replace(/[\\%_]/g, "\\$&")}%`;

/* ---------------- HTTP (Upstash REST) ---------------- */
async function rest(command) {
  const res = await fetch(REST_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${REST_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error(`Redis REST responded ${res.status}`);
  const data = await res.json();
  return data.result;
}

/* ---------------- Public API ---------------- */
export async function getJSON(key) {
  warnOnce();
  if (backend === "pg") {
    /* jsonb comes back parsed by the driver, so there is nothing to decode.
       A row that exists always has a value — the column is NOT NULL — so an
       absent row is the only way this answers null. */
    const r = await guard("read", () => pg("SELECT value FROM kv WHERE key = $1", [key]));
    return r.rows.length ? r.rows[0].value : null;
  }
  if (backend !== "memory") {
    const raw = await guard("read", async () => {
      if (backend === "http") return rest(["GET", key]);
      const client = await tcpClient();
      if (!client) throw new Error("no connection");
      return client.get(key);
    });
    return raw ? JSON.parse(raw) : null;
  }
  const local = memory.get(key);
  return local ? JSON.parse(local) : null;
}

export async function setJSON(key, value) {
  warnOnce();
  const raw = JSON.stringify(value);
  if (backend === "pg") {
    await guard("write", () => pg(
      `INSERT INTO kv (key, value, updated_at) VALUES ($1, $2::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, raw],
    ));
    return true;
  }
  if (backend !== "memory") {
    await guard("write", async () => {
      if (backend === "http") return rest(["SET", key, raw]);
      const client = await tcpClient();
      if (!client) throw new Error("no connection");
      return client.set(key, raw);
    });
    return true;
  }
  memory.set(key, raw);
  return true;
}

export async function del(key) {
  warnOnce();
  if (backend === "pg") {
    await guard("delete", () => pg("DELETE FROM kv WHERE key = $1", [key]));
    return true;
  }
  if (backend !== "memory") {
    await guard("delete", async () => {
      if (backend === "http") return rest(["DEL", key]);
      const client = await tcpClient();
      if (!client) throw new Error("no connection");
      return client.del(key);
    });
    return true;
  }
  memory.delete(key);
  return true;
}

/* Keys under a prefix — used by the admin panel to enumerate accounts.
   KEYS is fine at this scale; a deployment with enough accounts for it to
   hurt would already have moved user records to a real database. */
export async function listKeys(prefix) {
  warnOnce();
  const pattern = `${prefix}*`;
  if (backend === "pg") {
    const r = await guard("listKeys", () => pg(
      "SELECT key FROM kv WHERE key LIKE $1 ESCAPE '\\'", [likePrefix(prefix)]));
    return r.rows.map((row) => row.key);
  }
  if (backend !== "memory") {
    return (await guard("listKeys", async () => {
      if (backend === "http") return rest(["KEYS", pattern]);
      const client = await tcpClient();
      if (!client) throw new Error("no connection");
      return client.keys(pattern);
    })) || [];
  }
  return [...memory.keys()].filter((k) => k.startsWith(prefix));
}

/* Every document under a prefix, as { key, value }, ordered by key.

   For records kept one to a key, like the register's receipts, which are kept
   apart so that two tills saving at once cannot overwrite each other. Reading
   a month of those back one `getJSON` at a time is a query per sale; on
   Postgres this is one query, through the same prefix index as `listKeys`.
   Elsewhere it is the key listing followed by the reads. */
export async function listJSON(prefix) {
  warnOnce();
  if (backend === "pg") {
    const r = await guard("listJSON", () => pg(
      "SELECT key, value FROM kv WHERE key LIKE $1 ESCAPE '\\' ORDER BY key", [likePrefix(prefix)]));
    return r.rows.map((row) => ({ key: row.key, value: row.value }));
  }
  const keys = (await listKeys(prefix)).sort();
  const values = await Promise.all(keys.map((key) => getJSON(key)));
  return keys
    .map((key, i) => ({ key, value: values[i] }))
    .filter((row) => row.value !== null);
}

/* Test seam. */
export function __resetMemory() {
  memory.clear();
  warned = false;
  clientPromise = null;
}
