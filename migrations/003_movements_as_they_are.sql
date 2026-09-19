-- Make inventory_movements able to hold the ledger that already exists.
--
-- ─────────────────────────────────────────────────────────────────────────
-- What went wrong in 001
-- ─────────────────────────────────────────────────────────────────────────
--
-- The table was built from §4's description of the entity:
--
--   inventory_movements: ingredient_id, quantity_signed, unit_cost_snapshot,
--   reason, source_id, occurred_at; immutable traceable movements
--
-- and not from the ledger this application has been keeping for months. §1
-- warns about exactly that — "the entities below are a logical model, not
-- instructions to duplicate existing tables", and "reuse existing services and
-- tables where suitable" — and the warning was not heeded closely enough.
--
-- Backfilling into 001 as written would have lost real information and failed
-- outright on most rows. Three things were wrong.
--
-- **The type list was wrong.** 001 allowed six values. `_movements.js` has
-- eleven: opening, receive, transfer_in, production_in, issue, consume, waste,
-- return_out, transfer_out, adjust — and none of them are `sale` or `count`,
-- which 001 invented. Every historical `consume` and `transfer_out` row would
-- have violated the check constraint.
--
-- **`reason` meant two different things.** In 001 it was the enum. In the
-- ledger it is free text a person typed — "spoiled in the walk-in" — while
-- `type` is the enum. Migrating one into the other would have put prose in a
-- constrained column and thrown the prose away everywhere else.
--
-- **`auto` would have been dropped, and it is load-bearing.** Movements
-- written from sales carry it, and `_variance.js` excludes them: consumption
-- derived from sales cannot also be evidence about sales without the
-- arithmetic becoming circular. Losing the flag makes leakage read as zero
-- for ever — the exact failure `_salesdepletion.js` was written to avoid, and
-- one that looks like good news.
--
-- Also restored here: who recorded it, what they wrote on it, the till receipt
-- it came from, the quantity as a human typed it, and the link joining the two
-- halves of a branch transfer.
--
-- Nothing is dropped and nothing is renamed away: 001 has not been deployed
-- anywhere with data in it, but a migration that destroys a column is a
-- migration that cannot be rolled back, and that habit is worth keeping even
-- when the table is empty.

BEGIN;

-- ─── The type, as the application actually uses it ───────────────────────

ALTER TABLE inventory_movements
  ADD COLUMN type text;

UPDATE inventory_movements SET type = reason WHERE type IS NULL;

ALTER TABLE inventory_movements
  ALTER COLUMN type SET NOT NULL,
  ADD CONSTRAINT inventory_movements_type_known CHECK (type IN (
    'opening', 'receive', 'transfer_in', 'production_in',
    'issue', 'consume', 'waste', 'return_out', 'transfer_out',
    'adjust'
  ));

-- `reason` goes back to being what a person wrote, which means it can no
-- longer carry the enum's constraint.
ALTER TABLE inventory_movements
  DROP CONSTRAINT inventory_movements_reason_check,
  ALTER COLUMN reason DROP NOT NULL;

COMMENT ON COLUMN inventory_movements.reason IS
  'Free text, as entered by a person. The enum is `type`.';

-- ─── What the ledger carries that the table did not ──────────────────────

ALTER TABLE inventory_movements
  -- Written by the system from a sale rather than entered by a person.
  -- `_variance.js` excludes these, and must keep being able to.
  ADD COLUMN auto boolean NOT NULL DEFAULT false,

  -- Who recorded it. A ledger nobody can be asked about is not traceable.
  ADD COLUMN actor text,

  -- The quantity as a human typed it, with the unit they used. `quantity_signed`
  -- stays the one every total reads, in base units; this pair is so a screen
  -- can show "2 kg" rather than "2000 g" back to the person who wrote it.
  ADD COLUMN qty_entered numeric(20,6),
  ADD COLUMN unit_entered text,

  -- Cost per base unit, alongside the per-entered-unit figure. "12 per kg" and
  -- "0.012 per g" are the same fact; `_movements.js` computes both once rather
  -- than leaving every reader to divide, and a reader that picks the wrong one
  -- is out by a factor of a thousand.
  ADD COLUMN cost_per_base numeric(20,6),

  ADD COLUMN note text,
  -- The till receipt or document this came from. What "show me everything
  -- receipt 2-1043 consumed" filters on.
  ADD COLUMN ref text,

  -- The two halves of a branch transfer, joined. One movement out of one
  -- branch and one into another are a single act.
  ADD COLUMN transfer_id text,

  -- When the row was written, as distinct from when the movement happened. A
  -- delivery entered three days late has an `occurred_at` of Tuesday and a
  -- `recorded_at` of Friday, and a stock count needs to tell them apart.
  ADD COLUMN recorded_at timestamptz NOT NULL DEFAULT now();

-- `unit_cost_snapshot` keeps its meaning: the cost per base unit at the moment
-- of the movement, which is what `complete_order` writes and what costing
-- reads. `cost_per_base` above mirrors the ledger's own field name so a
-- backfill is a copy rather than a translation; they hold the same number.
COMMENT ON COLUMN inventory_movements.unit_cost_snapshot IS
  'Cost per BASE unit (g / ml / pcs) at the time of the movement.';

-- The identity a backfill is idempotent on. The Redis ledger mints its own
-- ids, so re-running the migration must find them rather than duplicate them.
ALTER TABLE inventory_movements
  ADD COLUMN legacy_id text;

CREATE UNIQUE INDEX inventory_movements_legacy_identity
  ON inventory_movements (business_id, legacy_id)
  WHERE legacy_id IS NOT NULL;

-- Filtering a branch's ledger by type, which the variance and costing readers
-- both do on every pass.
CREATE INDEX inventory_movements_type
  ON inventory_movements (business_id, branch_id, type);

COMMIT;
