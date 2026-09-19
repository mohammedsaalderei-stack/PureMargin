import pg from "pg";

/* The Postgres connection.

   ── Why TCP and a pool, and not the HTTP driver ──────────────────────────

   `_store.js` argues that HTTP suits serverless better than a held-open TCP
   connection, and for Redis under bursty traffic that is still true. The same
   instinct applied here would be out of date: Vercel's Fluid compute keeps a
   function warm long enough to reuse a connection, so the setup cost that made
   TCP expensive is paid once rather than per request, and Neon puts a PgBouncer
   pooler in front of every database to absorb the fan-out.

   So this is `pg` with a pool, pointed at the **pooled** connection string —
   the host with `-pooler` in it. Migrations use the direct one, because a
   pooler in transaction mode cannot run the session-level statements DDL
   sometimes needs, and a migration that half-applies through a pooler is a
   worse afternoon than any performance gain.

   ── One pool per warm instance ───────────────────────────────────────────

   Created lazily and kept, for the reason `_store.js` keeps one Redis client:
   building a pool per invocation would be slower than the query and would
   exhaust the connection limit under any real load.

   ── NUMERIC comes back as a string, and that is deliberate ───────────────

   `pg` does not parse NUMERIC into a JavaScript number, because it cannot know
   the column's scale survives a double. It hands back text. `api/_money.js` is
   the single doorway where that text becomes an exact integer, and nothing
   else in the codebase should be calling Number() on a value that came out of
   a money column. */

const POOLED = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
const DIRECT =
  process.env.DATABASE_URL_UNPOOLED
  || process.env.POSTGRES_URL_NON_POOLING
  || POOLED;

export const configured = Boolean(POOLED);

/* Verify the server's certificate, stated here rather than left to the URL.

   `pg` currently treats `sslmode=require` as `verify-full`, which is stronger
   than the name suggests and stronger than libpq means by it. Version 9 will
   adopt libpq's semantics, at which point `require` silently becomes "encrypt
   but do not check who you are talking to" — an in-flight downgrade to a
   man-in-the-middle being possible, introduced by a dependency bump rather
   than by anybody deciding it.

   Saying it in code closes that off, and closes off the more ordinary version
   of the same problem: the connection string is managed by Vercel's Neon
   integration, so it is not ours to guarantee. Somebody re-running the
   integration, or a colleague pasting a string from the dashboard with a
   different mode on it, cannot weaken the connection from here.

   `rejectUnauthorized` is the whole of it — Neon serves a publicly trusted
   certificate, so no bundled CA is needed and none is carried. */
const VERIFIED_TLS = { rejectUnauthorized: true };

let pool = null;

export function db() {
  if (!configured) {
    throw new Error(
      "No database configured. Set DATABASE_URL to the pooled Neon connection "
      + "string. See .env.example.",
    );
  }
  if (!pool) {
    pool = new pg.Pool({
      connectionString: POOLED,
      ssl: VERIFIED_TLS,
      /* Small on purpose. Every warm function instance holds its own pool, and
         the pooler in front of the database is what actually multiplexes —
         asking each instance for a large pool is how a connection limit is
         reached with most of them idle. */
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
    pool.on("error", (err) => console.error("[db] idle client error:", err.message));
  }
  return pool;
}

/* A direct, unpooled client. Migrations only.

   Returned rather than pooled because it is used once, by a script, and
   holding it open afterwards would keep a connection the application needs. */
export async function directClient() {
  if (!DIRECT) throw new Error("No database configured.");
  const client = new pg.Client({ connectionString: DIRECT, ssl: VERIFIED_TLS });
  await client.connect();
  return client;
}

export const query = (text, params) => db().query(text, params);

/* Everything inside one transaction, or none of it.

   This is the primitive the whole storage decision was made for. §5 requires
   recognition, cost snapshots and stock movements to commit atomically, and
   Appendix A's `complete_order` opens with `begin database transaction` — a
   thing the Redis store could not offer at all.

   The callback gets the client, not the pool: running one statement of a
   transaction on a different connection is the subtle version of this going
   wrong, and passing the pool would make that easy to do by accident. */
export async function transaction(fn) {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* the connection is going back anyway */ }
    throw err;
  } finally {
    client.release();
  }
}

/* Register an organization so its rows can carry a foreign key.

   Organizations live in Redis; this table holds an id and nothing else. Called
   on the first write for a business rather than at sign-up, so a customer who
   never places an order never appears here. */
export async function ensureBusiness(client, businessId) {
  if (!businessId) throw new Error("ensureBusiness: no business id");
  await client.query(
    "INSERT INTO businesses (id) VALUES ($1) ON CONFLICT (id) DO NOTHING",
    [businessId],
  );
  return businessId;
}

export async function close() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
