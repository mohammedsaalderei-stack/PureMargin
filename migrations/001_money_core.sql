-- The money core.
--
-- ─────────────────────────────────────────────────────────────────────────
-- Why these tables and not the others
-- ─────────────────────────────────────────────────────────────────────────
--
-- The gap analysis decided Postgres for the transactional core and Redis for
-- everything else. The line is not "new things here, old things there" — it
-- is whether a write has to be atomic with another write.
--
-- Completing an order must record the sale AND deduct the stock, or neither.
-- If orders live here and stock movements live in Redis there is no commit
-- that covers both, and the failure mode is the worst available: a sale with
-- no deduction, or stock gone for a sale that never committed. So movements
-- and purchases come too, even though they work perfectly well where they are.
--
-- Sessions, sign-in throttling, POS response caching, attendance and the
-- assistant's conversations all stay in Redis. None of them participate in a
-- money transaction, and several are caches that should not survive a restart.
--
-- ─────────────────────────────────────────────────────────────────────────
-- businesses is a registration, not a copy
-- ─────────────────────────────────────────────────────────────────────────
--
-- Organizations live in Redis: name, members, roles, branch allowance. None of
-- that is duplicated here. This table holds an id and a timestamp, and exists
-- only so every other table can carry a real foreign key — which is what §4
-- asks for ("enforce same-business relationships through database constraints
-- where possible") and what stops one restaurant's order line ever pointing at
-- another's order.
--
-- A row appears the first time an organization writes anything here. Two
-- sources of truth for a business name would be a worse problem than the one
-- this solves.
--
-- ─────────────────────────────────────────────────────────────────────────
-- On NUMERIC, and why the application still uses integers
-- ─────────────────────────────────────────────────────────────────────────
--
-- §6 proposes NUMERIC(20,6) and this follows it. `pg` returns NUMERIC as a
-- string rather than a number, precisely so a driver cannot round it on the
-- way past, and `api/_money.js` is the single doorway where that string
-- becomes an exact integer count of fils and back again.
--
-- The alternative — storing minor units as BIGINT — is equally exact and
-- reads as 2450 where a person looking at the table expects 24.50. Anybody
-- querying this database directly is doing finance, and NUMERIC is the type
-- that does not need explaining to them.

BEGIN;

CREATE TABLE businesses (
  id          uuid PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── Orders ──────────────────────────────────────────────────────────────

CREATE TABLE orders (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,

  -- Which system minted this order. §5 requires one authoritative source and
  -- a unique identity within it, so that importing a receipt and receiving its
  -- webhook cannot produce two deductions for one meal.
  source             text NOT NULL CHECK (source IN ('puremargin', 'loyverse', 'import')),
  external_order_id  text,

  channel            text NOT NULL DEFAULT 'dine_in'
                       CHECK (channel IN ('dine_in', 'takeaway', 'delivery', 'other')),

  -- Fulfilment and payment are separate lifecycles and must not be collapsed.
  -- §5: partial payment alone does not recognise a sale.
  fulfillment_status text NOT NULL DEFAULT 'new'
                       CHECK (fulfillment_status IN ('new', 'preparing', 'ready', 'completed', 'cancelled')),
  payment_status     text NOT NULL DEFAULT 'unpaid'
                       CHECK (payment_status IN ('unpaid', 'partially_paid', 'paid', 'partially_refunded', 'refunded')),

  branch_id          text,
  -- §4: an order may carry a table reference without implying table
  -- management. It is a label, deliberately not a foreign key to a tables
  -- table that does not exist and is out of scope.
  table_reference    text,
  shift_id           uuid,

  currency           char(3) NOT NULL DEFAULT 'AED',
  scheduled_at       timestamptz,
  completed_at       timestamptz,

  -- Optimistic concurrency (§7). Bumped on every state change; a transition
  -- carrying a stale number is refused with 409 rather than silently winning.
  version            integer NOT NULL DEFAULT 1,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- Completion is the moment a sale is recognised, so it must carry a time.
  CONSTRAINT completed_orders_have_a_time
    CHECK ((fulfillment_status = 'completed') = (completed_at IS NOT NULL))
);

-- One order per external id per source per business. Partial, because orders
-- raised inside PureMargin have no external id and NULLs would otherwise not
-- collide at all.
CREATE UNIQUE INDEX orders_external_identity
  ON orders (business_id, source, external_order_id)
  WHERE external_order_id IS NOT NULL;

CREATE INDEX orders_business_completed ON orders (business_id, completed_at DESC)
  WHERE fulfillment_status = 'completed';
CREATE INDEX orders_business_open ON orders (business_id, fulfillment_status)
  WHERE fulfillment_status IN ('new', 'preparing', 'ready');

CREATE TABLE order_lines (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id            uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  order_id               uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,

  variant_id             text,
  item_name              text NOT NULL,
  quantity               numeric(20,6) NOT NULL CHECK (quantity > 0),

  -- Snapshots, all of them. §5: a later recipe or purchase-price change must
  -- not rewrite what a sale cost at the time. These columns are the record of
  -- a moment and are never recalculated.
  price_snapshot         numeric(20,6) NOT NULL,
  discount_allocated     numeric(20,6) NOT NULL DEFAULT 0,
  tax_amount             numeric(20,6) NOT NULL DEFAULT 0,
  recipe_version         integer,
  materials_cost_snapshot numeric(20,6),

  -- §6: an unlinked ingredient or a missing cost makes the line's cost null
  -- and incomplete. Never zero — zero is a claim that it was free.
  cost_status            text NOT NULL DEFAULT 'complete'
                           CHECK (cost_status IN ('complete', 'incomplete', 'provisional')),

  created_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT complete_lines_have_a_cost
    CHECK (cost_status <> 'complete' OR materials_cost_snapshot IS NOT NULL)
);

CREATE INDEX order_lines_order ON order_lines (order_id);

CREATE TABLE order_line_modifiers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  order_line_id         uuid NOT NULL REFERENCES order_lines(id) ON DELETE CASCADE,

  option_id             text NOT NULL,
  option_name           text NOT NULL,
  price_snapshot        numeric(20,6) NOT NULL DEFAULT 0,
  -- §4: a substitution removes the original and adds the replacement. The
  -- delta is stored as taken, so oat milk replacing whole milk is one
  -- subtraction and one addition rather than a second full recipe.
  recipe_delta_snapshot jsonb,

  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX order_line_modifiers_line ON order_line_modifiers (order_line_id);

-- ─── Money in and money back ─────────────────────────────────────────────

CREATE TABLE payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  order_id     uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,

  amount       numeric(20,6) NOT NULL CHECK (amount > 0),
  method       text NOT NULL,
  status       text NOT NULL DEFAULT 'captured'
                 CHECK (status IN ('pending', 'captured', 'failed', 'voided')),
  external_id  text,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payments_order ON payments (order_id);

CREATE TABLE refunds (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  -- The original survives and is always referenced. §5: corrections are
  -- documented reversals, never silent deletion.
  order_id     uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,

  amount       numeric(20,6) NOT NULL CHECK (amount > 0),
  reason       text,
  external_id  text,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX refunds_order ON refunds (order_id);

CREATE TABLE refund_lines (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  refund_id          uuid NOT NULL REFERENCES refunds(id) ON DELETE CASCADE,
  order_line_id      uuid NOT NULL REFERENCES order_lines(id) ON DELETE RESTRICT,

  quantity           numeric(20,6) NOT NULL CHECK (quantity > 0),
  amount             numeric(20,6) NOT NULL,

  -- §5: money coming back does not put food back on the shelf. Restocking is
  -- a separate, explicitly confirmed quantity, and it defaults to none.
  restock_quantity   numeric(20,6) NOT NULL DEFAULT 0 CHECK (restock_quantity >= 0),

  CONSTRAINT cannot_restock_more_than_returned CHECK (restock_quantity <= quantity)
);

CREATE INDEX refund_lines_refund ON refund_lines (refund_id);

-- ─── The cost of selling through a channel ───────────────────────────────

CREATE TABLE channel_costs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  order_id       uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,

  kind           text NOT NULL
                   CHECK (kind IN ('commission', 'payment_fee', 'extra_packaging', 'other')),
  amount_ex_tax  numeric(20,6) NOT NULL,

  -- §6 requires commission rules to state fixed or percentage, and what they
  -- are taken on. Snapshotted, because an aggregator changing its rate must
  -- not rewrite what last month's orders cost.
  basis          text CHECK (basis IN ('fixed', 'percent_of_net', 'percent_of_gross')),
  rate_snapshot  numeric(20,6),

  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX channel_costs_order ON channel_costs (order_id);

-- ─── The till drawer ─────────────────────────────────────────────────────
--
-- Deliberately not employee attendance. §4 says so outright, and they answer
-- different questions: a shift is a cash drawer that has to reconcile, and
-- attendance is who was here. Attendance stays in Redis with its photographs.

CREATE TABLE pos_shifts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  branch_id      text,
  cashier_id     text NOT NULL,

  opened_at      timestamptz NOT NULL DEFAULT now(),
  closed_at      timestamptz,
  opening_cash   numeric(20,6) NOT NULL DEFAULT 0,
  expected_cash  numeric(20,6),
  counted_cash   numeric(20,6),
  -- Stored rather than derived, unusually for this codebase: it is what the
  -- person counting asserted at a moment, and recomputing it later from
  -- movements that have since been corrected would change history.
  difference     numeric(20,6),

  version        integer NOT NULL DEFAULT 1,

  CONSTRAINT closed_shifts_are_counted
    CHECK ((closed_at IS NULL) = (counted_cash IS NULL))
);

-- §7: one active shift per cashier per business.
CREATE UNIQUE INDEX pos_shifts_one_open_per_cashier
  ON pos_shifts (business_id, cashier_id)
  WHERE closed_at IS NULL;

ALTER TABLE orders
  ADD CONSTRAINT orders_shift_fk FOREIGN KEY (shift_id) REFERENCES pos_shifts(id);

-- ─── Stock, moved here so completion can be one transaction ──────────────

CREATE TABLE inventory_movements (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  branch_id          text,
  ingredient_id      text NOT NULL,

  -- Signed, in base units (g / ml / pcs). Positive is in, negative is out.
  quantity_signed    numeric(20,6) NOT NULL CHECK (quantity_signed <> 0),
  unit_cost_snapshot numeric(20,6),

  reason             text NOT NULL
                       CHECK (reason IN ('receive', 'issue', 'waste', 'count', 'sale', 'reversal')),
  source_id          text,
  -- Corrections are reversing entries, never edits or deletes — the rule the
  -- Redis ledger already follows, carried across unchanged.
  reverses_id        uuid REFERENCES inventory_movements(id),

  occurred_at        timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX inventory_movements_balance
  ON inventory_movements (business_id, branch_id, ingredient_id, occurred_at);

CREATE TABLE purchases (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  branch_id    text,
  supplier_ref text,
  received_at  timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE purchase_lines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  purchase_id    uuid NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,

  ingredient_id  text NOT NULL,
  quantity_base  numeric(20,6) NOT NULL CHECK (quantity_base > 0),
  unit_cost      numeric(20,6) NOT NULL CHECK (unit_cost >= 0),
  -- §6: purchase costs exclude recoverable tax and include the
  -- nonrecoverable part. Which is which is a business setting, so the
  -- components are kept rather than a single figure nobody can decompose.
  tax_components jsonb
);

CREATE INDEX purchase_lines_purchase ON purchase_lines (purchase_id);

-- ─── Making a retry harmless ─────────────────────────────────────────────
--
-- §7 requires an Idempotency-Key on order, refund and shift creation, scoped
-- to actor, business and route, with a fingerprint of the input: the same key
-- and the same payload returns the recorded result, the same key with a
-- different payload is a 409.
--
-- The stored response is what makes that possible. Without it a retry can be
-- recognised and still not answered.

CREATE TABLE idempotency_keys (
  business_id   uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  actor         text NOT NULL,
  route         text NOT NULL,
  key           text NOT NULL,

  fingerprint   text NOT NULL,
  response      jsonb,
  status_code   integer,

  created_at    timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (business_id, actor, route, key)
);

-- Swept periodically; a key older than a day is not a retry of anything.
CREATE INDEX idempotency_keys_age ON idempotency_keys (created_at);

-- ─── Integration events ──────────────────────────────────────────────────
--
-- The same guarantee the Redis ledger already gives for Loyverse receipts,
-- moved here so "has this been processed" and "what did processing write" are
-- one transaction rather than two systems agreeing after the fact.

CREATE TABLE integration_events (
  business_id   uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  source        text NOT NULL,
  event_id      text NOT NULL,

  payload_hash  text NOT NULL,
  state         text NOT NULL DEFAULT 'received'
                  CHECK (state IN ('received', 'processed', 'failed')),
  received_at   timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,

  PRIMARY KEY (business_id, source, event_id)
);

COMMIT;
