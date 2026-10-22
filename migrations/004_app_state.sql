-- A durable home for the application state that was living in Redis.
--
-- ─────────────────────────────────────────────────────────────────────────
-- Why this exists
-- ─────────────────────────────────────────────────────────────────────────
--
-- On 17-Oct-2026 the production Redis was deleted by the provider. Not by
-- anybody here: Redis Cloud reclaims a free 30MB database after fourteen
-- consecutive days with no commands reaching it, and free databases have no
-- backups and no recovery path of any kind. Data-persistence had been
-- disabled since the database was created, so there was never a snapshot to
-- lose. Accounts, organizations, the whole item master, every stock ledger,
-- every recipe, every purchase order and all of the attendance records went
-- with it.
--
-- The replacement was created on the same free tier with the same settings,
-- which means the same thing happens again in a fortnight. So the fix is not
-- a better Redis. It is to stop keeping anything that matters in a store
-- whose stated behaviour is to delete itself.
--
-- ─────────────────────────────────────────────────────────────────────────
-- Why a key/value table and not twenty proper ones
-- ─────────────────────────────────────────────────────────────────────────
--
-- The money core in 001–003 is relational because order lines, payments and
-- movements have relationships worth enforcing, and because completing an
-- order has to deduct stock in the same transaction. That reasoning does not
-- extend to the rest. `acct:<username>`, `org:<id>`, `inv:<org>:recipes` and
-- the rest are JSON documents read and written whole, with hand-rolled
-- secondary indexes (`email:<address>` → username) that already work.
--
-- Hand-modelling twenty of those into tables would mean rewriting twenty
-- modules and the twenty-six test files that write fixtures through them, to
-- fix a problem that is entirely about durability. The failure mode of that
-- rewrite is a silent data bug, and this codebase has paid for enough of
-- those. `_store.js` keeps its four-function interface, every caller is
-- untouched, and the data lands somewhere that still exists tomorrow.
--
-- This is deliberately a staging post, not a destination. Any one prefix can
-- be promoted to a real table later without callers noticing, because they
-- only ever asked for a key.
--
-- ─────────────────────────────────────────────────────────────────────────
-- jsonb rather than text
-- ─────────────────────────────────────────────────────────────────────────
--
-- jsonb validates on write, so a malformed document fails where it was
-- written instead of where it is read, and it can be queried into later
-- without a migration — "every account with this email" stops needing a
-- second key to stay in step.
--
-- The one thing it will not hold is a NUL byte inside a string, which Redis
-- would have stored happily. That is not data this application produces, and
-- if it ever does the write fails loudly rather than storing something that
-- cannot be read back. Loud is the rule here.

CREATE TABLE IF NOT EXISTS kv (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- `listKeys` asks for everything under a prefix — every stock ledger, every
-- account for the admin panel. The primary key's index is built with the
-- database's collation and cannot serve `LIKE 'inv:%'`; this one can.
CREATE INDEX IF NOT EXISTS kv_key_prefix ON kv (key text_pattern_ops);
