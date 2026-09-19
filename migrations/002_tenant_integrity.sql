-- Make a cross-business reference impossible to write.
--
-- ─────────────────────────────────────────────────────────────────────────
-- What 001 left open
-- ─────────────────────────────────────────────────────────────────────────
--
-- Every child table carries `business_id` with a foreign key to businesses,
-- and `order_id` with a foreign key to orders. Both constraints pass
-- individually while saying nothing about each other — so this is accepted:
--
--   INSERT INTO order_lines (business_id, order_id, ...)
--   VALUES ('<business B>', '<an order belonging to business A>', ...);
--
-- Business B's line now hangs off business A's order. Both foreign keys are
-- satisfied. A probe against the live database confirmed it goes in.
--
-- Nothing in the application would do that, and that is precisely the problem:
-- the guarantee rests on every writer remembering to scope, for ever, on every
-- path. §4 asks for these relationships to be enforced "through database
-- constraints where possible", and here it is possible.
--
-- ─────────────────────────────────────────────────────────────────────────
-- Composite keys
-- ─────────────────────────────────────────────────────────────────────────
--
-- A parent gets a redundant-looking UNIQUE (id, business_id) — redundant
-- because id is already unique, and necessary because a foreign key can only
-- target a unique constraint. The child then references both columns at once,
-- which makes the mismatch above unrepresentable: the pair has to exist, so
-- the child's business_id must equal the parent's.
--
-- The cost is one extra index per parent and a slightly wider key on each
-- child. Both are cheap next to a tenancy bug that would be silent, would be
-- found by a customer, and could not be proven not to have happened.

BEGIN;

-- ─── Parents gain the pair a composite key can point at ──────────────────

ALTER TABLE orders      ADD CONSTRAINT orders_id_business      UNIQUE (id, business_id);
ALTER TABLE order_lines ADD CONSTRAINT order_lines_id_business UNIQUE (id, business_id);
ALTER TABLE refunds     ADD CONSTRAINT refunds_id_business     UNIQUE (id, business_id);
ALTER TABLE purchases   ADD CONSTRAINT purchases_id_business   UNIQUE (id, business_id);
ALTER TABLE pos_shifts  ADD CONSTRAINT pos_shifts_id_business  UNIQUE (id, business_id);

-- ─── Children reference the pair ─────────────────────────────────────────

ALTER TABLE order_lines
  DROP CONSTRAINT order_lines_order_id_fkey,
  ADD CONSTRAINT order_lines_order_fk
    FOREIGN KEY (order_id, business_id) REFERENCES orders (id, business_id)
    ON DELETE CASCADE;

ALTER TABLE order_line_modifiers
  DROP CONSTRAINT order_line_modifiers_order_line_id_fkey,
  ADD CONSTRAINT order_line_modifiers_line_fk
    FOREIGN KEY (order_line_id, business_id) REFERENCES order_lines (id, business_id)
    ON DELETE CASCADE;

ALTER TABLE payments
  DROP CONSTRAINT payments_order_id_fkey,
  ADD CONSTRAINT payments_order_fk
    FOREIGN KEY (order_id, business_id) REFERENCES orders (id, business_id);

ALTER TABLE refunds
  DROP CONSTRAINT refunds_order_id_fkey,
  ADD CONSTRAINT refunds_order_fk
    FOREIGN KEY (order_id, business_id) REFERENCES orders (id, business_id);

ALTER TABLE refund_lines
  DROP CONSTRAINT refund_lines_refund_id_fkey,
  ADD CONSTRAINT refund_lines_refund_fk
    FOREIGN KEY (refund_id, business_id) REFERENCES refunds (id, business_id)
    ON DELETE CASCADE;

-- The one that would matter most in practice: a refund line pointing at a
-- line of somebody else's order would move money against another business's
-- sale.
ALTER TABLE refund_lines
  DROP CONSTRAINT refund_lines_order_line_id_fkey,
  ADD CONSTRAINT refund_lines_order_line_fk
    FOREIGN KEY (order_line_id, business_id) REFERENCES order_lines (id, business_id);

ALTER TABLE channel_costs
  DROP CONSTRAINT channel_costs_order_id_fkey,
  ADD CONSTRAINT channel_costs_order_fk
    FOREIGN KEY (order_id, business_id) REFERENCES orders (id, business_id)
    ON DELETE CASCADE;

ALTER TABLE purchase_lines
  DROP CONSTRAINT purchase_lines_purchase_id_fkey,
  ADD CONSTRAINT purchase_lines_purchase_fk
    FOREIGN KEY (purchase_id, business_id) REFERENCES purchases (id, business_id)
    ON DELETE CASCADE;

-- An order may only sit in a shift belonging to the same business.
ALTER TABLE orders
  DROP CONSTRAINT orders_shift_fk,
  ADD CONSTRAINT orders_shift_fk
    FOREIGN KEY (shift_id, business_id) REFERENCES pos_shifts (id, business_id);

-- A reversal reverses a movement of the same business. Left as a plain key in
-- 001, and the same argument applies: a reversing entry that cancelled another
-- restaurant's stock movement is worse than most things this schema prevents.
ALTER TABLE inventory_movements
  ADD CONSTRAINT inventory_movements_id_business UNIQUE (id, business_id);

ALTER TABLE inventory_movements
  DROP CONSTRAINT inventory_movements_reverses_id_fkey,
  ADD CONSTRAINT inventory_movements_reverses_fk
    FOREIGN KEY (reverses_id, business_id)
    REFERENCES inventory_movements (id, business_id);

COMMIT;
