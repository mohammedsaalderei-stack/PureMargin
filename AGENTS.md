# Base44 dev environment

## What this app is
Sufra / PureMargin — sales intelligence for restaurants. Vite + React frontend with
Vercel-style serverless API functions in `/api/*.js` (each exports
`export default async function handler(req, res)`). Originally deployed on Vercel
(`vercel dev` runs both site + API). Here it runs via docker compose instead.

## How it runs here
- `docker-compose.base44.yml` — four services:
  - `setup` (one-shot `npm install`, exits)
  - `redis` — account & conversation storage (healthchecked)
  - `api` — `node server.js`, a small Node http server that mounts every
    `/api/*.js` handler under `/api/<name>` on port 3001 (internal). It shims
    `res.status()`/`res.json()` onto the native response; everything else
    (`setHeader`, `write`, `end`, `headersSent`) is native.
  - `web` — `npx vite --host 0.0.0.0 --port 5173`, host port 3000. Vite proxies
    `/api` → `http://api:3001` (single origin, no CORS needed).
- Start: `docker compose -f docker-compose.base44.yml up -d`
- Preview: port 3000 → the Vite dev server (live reload).

## Secrets
- `ANTHROPIC_API_KEY` — required for the Ask (اسأل) chat screen only. The app
  boots and all other screens work without it (chat returns a clear error).
- `LOYVERSE_ACCESS_TOKEN` — optional; without it the dashboard runs on labelled
  demo data.
- `FEEDBACK_WEBHOOK_URL` — optional.
- `SESSION_SECRET` — has a dev fallback in `.env.base44-defaults`.
- `REDIS_URL` is wired by compose to the local redis service (not a secret).
Secrets are delivered via `/run/base44/app.env` (listed last in `env_file:` so
they override the defaults).

## Verify it works
- `curl -sf -H "Host: external-preview.example.com" http://localhost:3000/`
  returns the HTML (Vite `allowedHosts: true`).
- `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/metrics`
  → `401` (proxy + auth working).
- Vite logs show live esbuild of `src/*.jsx` (serves source, not a build).

## Tests
- `npm test` → `api/_org.test.js` (stage 1 authorization + stage 2 aggregation)
  then `api/_journal.test.js` (stage 3 journal, audit, sync, provenance), then
  `api/_inventory.test.js` (stage 4 units, conversions, item master). 58 tests. It writes fixture accounts through `api/_store.js`, so it refuses
  to run unless the store backend is `memory` — the npm script blanks
  `REDIS_URL`/`KV_URL`/`KV_REST_API_URL` to force that. Never run the file
  directly inside the `api` container with Redis attached; it will bail out
  rather than pollute real records.

## Multi-branch authorization (stage 1 of the product direction)
- `api/_org.js` — organizations, roles, membership, scope resolution. Every
  account owns an organization from registration (`orgFor` backfills accounts
  that predate this). Roles: `owner`, `ops`, `branch_manager`, `chef`,
  `accountant`; each has capabilities and a scope rule (`all` | `assigned`).
- **Branches are POS stores, not a local table.** `branchList()` in `_data.js`
  reads `/stores`. Permissions only decide who may see which of those ids, so
  there is nothing to keep in sync.
- The rule from the document, in `effectiveBranches()`:
  `requested ∩ authorized`. Empty request = everything you're allowed to see,
  which is what keeps an owner's dashboard one consolidated view.
- Scope is always derived from the session's account. `?branches=` can only
  narrow, never widen — an out-of-scope id drops out of the intersection.
- **`api/_aggregate.js` is the branch-scopable core** (stage 2). Receipt folding
  used to live inside the Loyverse fetch, which made every figure org-wide. Now
  `_data.js` caches only the raw upstream read (`fetchRaw`) and `aggregate()`
  runs per scope over it, so `items`/`daily`/`hours`/`payments`/costs are all
  scoped exactly — branch scopes sum back to the org total (tested).
  `getMetrics(token, { branches })` takes an already-authorized list; `null`
  means the whole organization. `branches: []` correctly yields zeros.
- The cache key is now just the token (overrides moved into aggregation), which
  also means entering a cost shows up without waiting for a refetch, and
  `cacheAge()` works for accounts with overrides — it used to miss the key.
- `branchList()` reuses that cache when warm, so resolving scope on every
  metrics request doesn't cost a second `/stores` call.
- `api/_scope-metrics.js` now only attaches scope provenance (`branches`,
  `branchCount`, `totalBranches`, `complete`, `exact`) and filters the branch
  roster to what the user may see.
- `api/scope.js` (GET) feeds the UI scope selector; `api/team.js` is membership
  administration, gated on `manage:users` (owner only).
- Inviting a username with no account writes `invite:<username>` → orgId, so
  registering joins that organization instead of creating a new one.

## Provenance and logs (stage 3)
- `api/_journal.js` — one capped (50), newest-first append-only list over the KV
  store, shared by both logs. Read-modify-write of a single array, so it can lose
  an entry under concurrent writes: **nothing may read these logs to make a
  decision.** They exist to be read by a person.
- `api/_sync.js` — `sync:<orgId>`. Records only reads that actually went upstream
  (`metrics.fetch.wentUpstream` from `getMetrics`), never cache hits, or the log
  would append every 30s poll and mean nothing. Failures are recorded with their
  reason; `lastSync(org, { ok: true })` answers "when did it last work".
- `api/_audit.js` — `audit:<orgId>`. Closed list of action keys (`AUDIT_ACTIONS`);
  an unknown action is dropped rather than logged unlabelled, and a test asserts
  every key has a label. Writes are best-effort — an audit failure must never
  fail the action it describes. Hooked into `team.js` (add/update/remove, with
  the previous role/branches in `detail`), `account.js` (POS connect/disconnect,
  all three deletion paths) and `password.js` (change, sign-out-everywhere).
- `api/_provenance.js` — the evidence block on every metrics payload: source,
  `fetchedAt` vs `ageSeconds` (last upstream read vs staleness of what you see),
  period, branch names, receipts fetched vs counted, cost coverage. Fed by the
  `fetch` block `getMetrics` now returns; `metrics.js` strips `fetch` and
  `allBranches` from the response so internals don't reach the client.
- Both logs are returned by `GET /api/team` (owner-only, same `manage:users`
  gate) rather than a new endpoint.
- **`branchList()` wraps upstream failures in `PosUnreachable`.** It moved ahead
  of `getMetrics` in stage 2, and unwrapped it made a POS outage a generic 500
  with no failed-sync entry — the exact "no sales" vs "couldn't ask" confusion
  this stage exists to remove. Keep it wrapped.
- Front end: `src/Provenance.jsx` (collapsed one-liner under the Overview,
  expands to the full account; shouts only when the last sync failed) and
  `src/TeamActivity.jsx` (`SyncLog` + `AuditLog`, read-only, rendered in the Team
  screen). Action labels are translated client-side from `t.activity.actions`.
- i18n: `provenance.*` and `activity.*` in all four languages.

## Inventory and units (stage 4, phase 1 — item + unit master)
- `api/_units.js` — the unit system. Every unit declares a dimension (mass/volume
  /count) and how many base units it holds (g, ml, piece); conversion is
  multiply-to-base then divide-to-target, never a table of pairs. **Cross-dimension
  conversion returns `null`, never a number** — a litre of oil is not a kilogram
  of oil, and the density belongs to the ingredient. `costPerBase()` turns "case
  of 12 × 1L for 90" into a cost per ml and returns `null` for a degenerate pack,
  so "free" and "unknown" can't be confused. A global `case`/`sack` unit must
  never be added: pack shapes are item-specific (`packSize`).
- `api/_inventory.js` — ingredients, suppliers, categories, locations. Keys are
  `inv:<orgId>:*`, so **isolation is structural** — a query cannot reach another
  org even if asked. Ids are `slug(name)`, so re-importing a sheet updates instead
  of duplicating, and the name is therefore immutable in the UI (history points at
  the id). Ingredients are **archived, never deleted**. A supplier referenced by
  any ingredient (including archived ones) can't be removed.
- **No quantities live here.** A balance is the sum of the movement ledger
  (phase 2); storing an editable "on hand" would create a second truth for a
  derived number. Don't add one to this file.
- Branch differences go in `branchOverrides[branchId]`, resolved by `forBranch()`
  — never a duplicate ingredient per branch, which is what makes group-wide
  reporting impossible.
- `api/inventory.js` — gated on the stage-1 capabilities (`view:inventory` to
  read, `manage:inventory` to write), org always from the session. Every write is
  audit-logged (`ingredient.*`, `supplier.*` in `AUDIT_ACTIONS`). Validation
  returns a *field name*; the client owns the wording in four languages
  (`t.inventory.errors`).
- Front end: `src/screens/Inventory.jsx` + `src/inventory/{IngredientForm,
  SupplierList}.jsx`. The tab is appended in `Shell.jsx` behind `view:inventory`
  (like the team tab) and is `null` in `SCREEN_FEATURE` — a permission, not a plan
  feature.
- **Open question:** the accountant role has no `view:inventory`, so it currently
  gets 403 here, but the document's role table grants accountants "purchases".
  Revisit when purchasing lands in phase 2.

## Stock movement ledger (stage 4, phase 2)
- `api/_movements.js` — the ledger. Keys are `inv:<orgId>:moves:<branchId>`, so
  isolation is structural *and* a branch's ledger can't leak into another's read.
- **A balance is never stored.** `balances(orgId, branchIds, { ingredients })`
  sums `qtyBase` over the entries. Do not add an on-hand field anywhere.
- Every entry keeps the quantity twice: `qty` + `unit` as typed (what a human
  recognises) and `qtyBase` in the ingredient's base unit (what arithmetic uses).
  Summing across kg and g entries is only correct on the second.
- `MOVEMENT_TYPES` is closed and each type carries its sign. `adjust` is the only
  signed type (sign 0 → taken from the quantity); every other type ignores the
  sign the user typed, so "waste 500" can't accidentally add stock.
- **Correction is reversal only.** No delete exists in the module or the route.
  Reversing twice is refused (`reversed`), and a reversal can't be reversed
  (`isreversal`), so a double-click can't cancel its own correction.
- Transfers are two entries sharing a `transferId`, written out-leg first: if the
  in-leg fails the out-leg is reversed, so stock is never duplicated. Cost is
  inherited by the receiving branch — moving stock must not revalue it.
- Negative-stock policy lives at `inv:<orgId>:policy`, default **refuse**.
  Refusal returns `{ error: "negative", onHand, short }` in the ingredient's
  stock unit; the client owns the wording.
- Movement ids are generated server-side, never accepted from the client — a
  client id is how a retry becomes a double count.
- `api/stock.js` — `view:inventory` to read, `manage:inventory` to write. Every
  branch id from a client goes through `effectiveBranches([id], authorized)`
  (both ends, for transfers), so a body edit can't write into another branch.
  No DELETE method, deliberately.
- Audit: `stock.movement`, `stock.transfer`, `stock.reverse`, `stock.policy`.
- Front end: `src/inventory/StockPanel.jsx` (balances, per-branch split, the
  per-branch ledger with the reverse control) + `src/inventory/MovementForm.jsx`
  (one form for movements and transfers). Mounted in `src/screens/Inventory.jsx`.
  i18n block is `inventory.stock.*` in all four languages.
- Tests: `api/_movements.test.js` (21), wired into `npm test`.
- Entries also carry `costPerBase` (unitCost per base unit, computed at write
  time). `lastCostPerBase(orgId, branchIds, ingredientId)` reads the newest
  incoming, non-reversed entry — this is the "last cost" counts value variance at.

## Stock counts (stage 4, phase 3)
- `api/_counts.js`, key `inv:<orgId>:counts`. Statuses: draft → review →
  approved, plus `cancelled`. Cancelled counts are kept, never deleted.
- **Expected quantities are snapshotted when the count opens**, not read at
  approval. Otherwise trading between printing the sheet and signing it off shows
  up as variance nobody caused.
- **`countedQty: null` means "not counted" and is never treated as zero.** Zero is
  a real statement (the shelf is empty); a blank must not write off stock.
- Approval is the only step that touches stock: one `adjust` movement per line
  with a real variance, `ref: count:<id>`, ids stored on `count.movementIds`. It
  **bypasses the negative-stock policy on purpose** — a physical count is the
  authoritative statement, so refusing it would leave the ledger contradicting
  the shelf.
- Totals keep `shrinkValue` and `gainValue` apart (netting them hides a shelf
  short on meat and long on flour), plus `coverage` and `unpriced` as the
  data-quality status. The valuation is frozen onto the record at approval.
- Capability `approve:counts` — owner, ops, branch manager. **Chef deliberately
  does not have it**: they record a count, somebody else approves it.
- Audit: `count.open`, `count.submit`, `count.reopen`, `count.approve`,
  `count.cancel`.
- Front end: `src/inventory/CountsPanel.jsx` (list + open form) and
  `src/inventory/CountSheet.jsx` (the sheet, variance, workflow buttons). A
  reason selector only appears on lines that actually differ. i18n block
  `inventory.counts.*`.
- Tests: `api/_counts.test.js` (26), wired into `npm test`.

## Purchasing and receiving (stage 4, phase 4)
- `api/_purchasing.js`, key `inv:<orgId>:purchases`. Statuses: draft → open →
  partial → received, plus `cancelled`.
- **Ordered, received and invoiced are three separate records.** The order's lines
  are never rewritten by a delivery — quantity variance and price variance are
  differences between records, so collapsing them loses the number.
- Receiving is additive: any number of partial receipts, each writing its own
  `receive` movements (`ref: po:<id>`), ids kept on the receipt.
- **Discounts and charges are allocated pro rata by line value** and landed on the
  movement's `unitCost`. A value of zero across the receipt allocates nothing
  rather than dividing by it.
- Price variance compares `pricePerBase` agreed vs invoiced, so ordering by the
  dozen and receiving by the each can't fake one.
- **Over-receipt is refused** (`{ error: "over", remaining, unit }`, HTTP 422) —
  it's a typo, not a variance. All validation happens before any movement is
  written, so a rejected line can't leave half a delivery on the shelf.
- Returns write `return_out` at the cost the goods came in at, capped at what
  arrived (`overreturn`), and do **not** reopen a received order.
- Ordering may use any unit of the ingredient's dimension (its purchase unit
  usually). There is no global "case"/"sack" unit — pack shapes live on the
  ingredient, by design in `_units.js`.
- Capability `manage:purchasing` — owner, ops, branch manager and **accountant**
  (the document gives them purchases; they also gained `view:inventory`, since a
  PO is unreadable without the item master). Chef deliberately has neither.
- Audit: `po.save`, `po.submit`, `po.cancel`, `po.receive` (records the invoice
  number and total), `po.return`.
- Front end: `src/purchasing/PurchasingPanel.jsx` (list) → `OrderForm.jsx` (raise)
  → `OrderSheet.jsx` (summary, lines, receipts, returns) → `ReceiveForm.jsx`
  (pre-filled with what is still owed at the agreed price). i18n
  `inventory.purchasing.*`.
- Tests: `api/_purchasing.test.js` (26).

## Recipes and recipe cost (stage 4, phase 5)
- `api/_costing.js` — ingredient cost per **base unit**, two methods, both real:
  `last` (newest priced receipt) and `wavg` (value received ÷ quantity received,
  the default). `costBasis(orgId, branchIds, { to })` walks each branch's ledger
  **once** and returns both plus provenance (`receipts`, `lastAt`); recipes share
  one basis rather than re-reading per line.
  - Only incoming, priced, non-reversed entries inform cost — issues/waste carry an
    inherited cost and would double-count the delivery.
  - **No cost is `null`, never 0.** Zero is the one default that flatters margin
    exactly where data is worst; callers must report the gap.
- `api/_recipes.js`, key `inv:<orgId>:recipes`. Recipes are org-level master data;
  **cost is local**, from the authorized branches' ledgers.
- **Versions are dated and append-only** (`effectiveFrom`, sorted, never edited).
  `effectiveVersion(recipe, at)` = newest already in force, so a March sale keeps
  March's recipe. Back-dating slots into history. No DELETE anywhere; archive only.
- **Lines are net (as they end up in the dish)**; `yieldPct` converts to
  `drawBase`, the gross draw on stock (150 g at 75% draws 200 g).
- **Packaging is a separate list**: costed into the dish, excluded from food cost,
  and *not* subject to yield (trimming a carrot doesn't waste the box).
- Costing reports `complete`, `coverage` and `unpriced[]`; a partial total is a
  stated lower bound.
- `simulate()` applies cost/qty/portion/price overrides to a **copy** of the basis
  and version and runs the same `costVersion` — no parallel formula, nothing
  written. Returns before/after/delta including margin points.
- `marginFor` is **gross** margin only; contribution margin waits for the
  operating-cost layer the document defers.
- Route `api/recipes.js`: `view:costs` reads (so the accountant can), `manage:recipes`
  writes (so the chef can). Simulation only needs read. Audit: `recipe.create`,
  `recipe.version`, `recipe.archive`, `recipe.restore`.
- Front end: tab `recipes` in `Shell.jsx` gated on `view:costs`;
  `src/screens/Recipes.jsx` (list + cost-basis switch) → `recipes/RecipeForm.jsx`
  → `recipes/RecipeSheet.jsx` → `recipes/CostSimulator.jsx`. i18n `recipes.*`.
- Tests: `api/_recipes.test.js` (25).

## Theoretical vs actual — the variance engine (stage 4, phase 6)
- `salesLines(posToken, { from, to, branches })` in `api/_data.js` — line-level sold
  quantities per branch from the **same cached receipts** as `aggregate` (which
  can't serve this: 30-day org totals, rounded, top-14 only). Refunds/cancelled
  excluded. Returns fetch provenance including `limitedHistory`.
- `api/_variance.js`:
  - `theoreticalUsage(salesRows, recipes, { at })` — sold qty ÷ `portions`, gross
    draw (`qtyBase / yield`), summed per ingredient. Packaging excluded (costed
    into the dish, not counted against the walk-in). Matching is on POS item name,
    case/space-insensitive, variant preferred then blank-variant fallback.
  - Recipe version used = the one in force **at period end**, same rule as the
    recipe screen; per-receipt dating is deliberately not claimed since sales rows
    are aggregated.
  - `actualUsage` — `consume`/`issue`/`waste` plus signed `adjust`. **`transfer_out`
    and `return_out` are excluded**: the stock moved, it wasn't used — counting
    them would invent a variance in one branch and hide it in the other. Reversed
    entries and reversals both skipped.
  - `varianceReport` decomposes: `variance = actual − theoretical`, of which
    `waste` and `adjustment` are explained; the remainder is **`unexplained`** —
    theft, over-portioning, unrecorded waste or a wrong recipe. Rows are ranked by
    |unexplained value|, not quantity.
  - Two refusals: sales with no recipe are reported (`quality.recipeCoverage`,
    `unmatched[]`) because low coverage understates theoretical and makes variance
    read worse than it is; unpriced ingredients give quantity variance with
    `value.* === null`, never 0.
- Route `api/variance.js`, GET only, `view:costs`. Works with the POS missing —
  shows actual usage and reports `sales.error` rather than a confident total.
- Front end: tab `variance` (`view:costs`) → `src/screens/Variance.jsx` +
  `src/variance/VarianceRow.jsx`. i18n `variance.*`.
- Tests: `api/_variance.test.js` (25).

## Targets and alerts (stage 4, phase 7)
- `api/_alerts.js` — `getTargets`/`saveTargets` (`inv:{org}:targets`, values clamped
  on save so a 0% target or 5000 cover days can't silence/flood the list) and
  `buildAlerts(orgId, branchIds, { salesRows, from, to, method })`, which runs one
  `varianceReport` + `balances` so an alert can never disagree with the leakage
  screen.
- Kinds (each pinned to a recommended `action` key in `ALERT_KINDS`, so an alert
  can't be added without deciding what to do about it): `foodcost`, `variance`,
  `stockout`, `reorder`, `negative`, `slowmoving`, `expiry`, `norate`.
- Rules that matter: **no forecast without a usage rate** — stock with a threshold
  but no issues in the period raises `norate`, never a projected date; variance
  needs to pass **both** `variancePct` and the money floor `varianceFloor`; a
  negative balance is a data problem (`countStock`), not a purchasing one, and
  suppresses the cover alert; expiry is inferred from `shelfLifeDays` + last
  movement and is marked `estimated: true`.
- **No English in the payload** — alerts carry `kind`/`action`/numbers only;
  wording is `alerts.*` in `src/i18n.jsx` across all four languages.
- Route `api/alerts.js`: GET needs `view:inventory`, PUT `{targets}` needs
  `manage:costs` and writes audit action `targets.update`.
- Front end: tab `alerts` (`view:inventory`) → `src/screens/Alerts.jsx` +
  `src/alerts/AlertCard.jsx`, `src/alerts/TargetsForm.jsx`. Empty state
  distinguishes "nothing wrong" from "nothing recorded" via `recipeCoverage`.
- Tests: `api/_alerts.test.js` (24).

## Operational forecasting (stage 5)
- `api/_operations.js`:
  - `purchasePlan(orgId, branchIds, { from, to, horizonDays, stale })` — usage rate
    from **weekly** buckets of `consume`/`issue`/`waste` (weekly because restaurant
    demand is weekend-seasonal; daily is noise, monthly hides trend). Transfers and
    supplier returns are excluded — ordering for another branch's shelf.
  - Need = `perDay × (horizon + supplier lead time) − on hand`; range is ±1 SD of
    the weekly mean scaled to the same window; packs rounded up via `toBase` on the
    purchase unit. **Lead time comes from the supplier record**, not the ingredient.
  - `gradeConfidence({ days, weeksWithUsage, cv, stale })` — reasons are
    `shortHistory` (<14d), `fewWeeks` (<2), `volatile` (cv>0.6), `staleSales`; either
    of the first two rules out `high` on its own. A plan's headline confidence is the
    **weakest** row's (`worstOf`).
  - No usage in the period → **no line**, an entry in `skipped` with reason
    `nousage`. An empty plan and a plan of zeroes mean different things.
  - `branchRanking` runs `varianceReport` per branch so the ranking can never
    contradict the leakage screen; each row carries food cost vs target, waste,
    unexplained, top-3 driver ingredients and that branch's `recipeCoverage`.
- Route `api/operations.js` GET: purchase plan needs `view:forecast`, ranking needs
  `view:profitability`, either alone is enough. Sales older than 12h (or missing)
  set `stale`, which downgrades every confidence grade rather than passing unnoticed.
- Front end: tab `plan` → `src/screens/Plan.jsx` + `src/plan/PurchaseLine.jsx`,
  `src/plan/BranchRanking.jsx`. i18n `plan.*`. Entitlement: `forecast`.
- Tests: `api/_operations.test.js` (24).
- **Careful in tests:** `varianceReport`/`listMovements` bound by `to`, so a movement
  recorded with the default `at` (now) falls *outside* a window captured earlier —
  pass an explicit `at`.
## Assistant grounding (stage 6)
- `api/_grounding.js` is the **only** path by which inventory/costing/forecast
  figures reach the model. `groundingFor(account, {...})` resolves the session's
  scope, intersects the requested branches with the authorized ones, filters the
  sales rows to that scope, then builds a prose brief from the same engines the
  screens use (`varianceReport`, `buildAlerts`, `purchasePlan`, `branchRanking`).
- **The prompt is the boundary.** An out-of-scope branch's name and figures are
  absent from the brief, not withheld by instruction — "don't mention branch 2" is
  not a security control. Sections are gated by capability: `view:costs` → leakage,
  `view:inventory` → alerts, `view:forecast` → purchasing plan,
  `view:profitability` **and** >1 branch → branch comparison.
- `ANSWER_CONTRACT` (same file) is the answering rules: value, period, branches,
  evidence, drivers, confidence limits, one or two actions; refuse out-of-scope
  branches without confirming they exist; never fill a gap from general knowledge.
- `api/chat.js` composes `buildSystem(metrics, lang, grounding)` — the POS sales
  context as before, then the contract and brief. Grounding is best-effort: if the
  org or POS lookup fails the assistant still answers from sales alone.
- Tests: `api/_grounding.test.js` (16) — 245 total. `scopeFor` **auto-creates** an
  org for an account without one, so "no org" fixtures resolve to a fresh empty
  organization rather than null.
## Scope selector wiring
- `src/BranchScope.jsx` lives in the Shell (all branches / a group / one branch) and
  its selection now reaches every scoped surface: `Variance`, `Alerts`, `Plan` take
  a `branches` prop and append `scopeQuery(branches)`; `Ask` sends `branches` in the
  chat body, which `api/chat.js` passes to the grounding as `requested`.
- `src/scopeParam.js` holds the one convention: **empty selection = all authorized
  branches** (same as an absent parameter server-side), plus `scopeKey` for effect
  deps since arrays compare by identity.
- The client only ever *requests* a scope; every route and the grounding intersect
  it with the session's authorization, so an edited parameter or request body can
  narrow a view but never widen it.
- **All six stages of the direction document are implemented.** Remaining from the
  doc: storage locations in the item master, and drill-through from an aggregate (or
  an assistant answer) to the underlying invoice/movement/count in every case.

## Sign-in email
- `setEmail(username, currentPassword, nextEmail)` in `api/_accounts.js`, exposed
  as `PATCH /api/account` (`{ email, current }`). Separate method from `PUT`,
  which owns the POS token — one body carrying both would be ambiguous.
- **The current password is required.** The address is a sign-in credential and
  the password-reset destination, so changing it unchallenged takes the account.
- The `email:<address>` index moves with it: old key deleted first, new one
  written after. An empty string removes the address — legal (the username still
  signs in) but password reset stops working, which the UI states both before and
  after. Codes: 401 wrong password, 409 taken, 400 malformed.
- Audit `email.change` records from/to — unlike a password, the addresses are
  exactly what an owner needs to see later.
- UI: `src/settings/EmailSetting.jsx` in the account panel of Settings, i18n
  block `emailChange.*`.

## Account deletion
Two paths, both on `DELETE /api/account`:
- default — `requestDeletion`, a 7-day grace window, undoable with `POST`.
- Both paths are gated in the UI by `src/DeleteConfirm.jsx`: the word `DELETE`
  must be typed (trimmed, case-insensitive) before the red confirm button
  enables. Autocomplete/autocorrect are off so the browser can't complete it.
- `?now=1` — `deleteNow()` in `_accounts.js`, an immediate wipe returning `410`.
  Removes the account, email index, chats, cost overrides and pending invite. If
  the account **owns** an organization the org record goes too (the POS
  connection and all memberships live on it); if it was only a member, just its
  seat is removed. No undo. The UI signs the user out on success, since the
  token's account no longer exists.

## Front end
- `src/BranchScope.jsx` — the scope selector (all / group / one branch). Renders
  nothing below two authorized branches. Empty selection = all, matching the API.
- `src/screens/Team.jsx` — membership admin. Shown as a nav tab only when
  `/api/scope` reports `manage:users`; the server enforces it regardless.
- `Shell.jsx` holds `scope` (from `/api/scope`) and `branches` (the request), and
  refetches metrics when the selection changes.
- i18n: new `scope.*` and `team.*` blocks plus `account.deleteNow*` in all four
  languages (en, ar, hi, tl).

## Notes
- `vite.config.js` was extended with `host`, `allowedHosts: true`, and the
  `/api` proxy — needed to run outside Vercel. Original had only `port: 5173`.
- `server.js` and `.env.base44-defaults` are new, dev-only.
- i18n.jsx emits duplicate-key warnings (pre-existing, harmless).
