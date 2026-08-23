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
- Tests: `api/_counts.test.js` (26), wired into `npm test` — 105 total.
- **Still open:** purchasing/receiving and the costing engine.

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
