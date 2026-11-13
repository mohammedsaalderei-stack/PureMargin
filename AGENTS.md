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
- `FEEDBACK_WEBHOOK_URL` — optional.
- `SESSION_SECRET` — has a dev fallback in `.env.base44-defaults`. It also
  encrypts each business's Loyverse token: **changing it disconnects every
  Loyverse connection** (they show as "connect again").
- `LOYVERSE_ACCESS_TOKEN` (or `POS_ACCESS_TOKEN`) — optional; used only for
  the business whose owner signs in with `ADMIN_EMAIL`.
- `REDIS_URL` is wired by compose to the local redis service (not a secret).
Secrets are delivered via `/run/base44/app.env` (listed last in `env_file:` so
they override the defaults).

## Where durable data lives (and why it moved)

- **The production Redis was deleted by the provider on 17-Oct-2026.** Redis
  Cloud reclaims a free 30MB database after fourteen consecutive days with no
  commands reaching it; free databases have no backups and no recovery path,
  and data-persistence had been off since creation, so there was never a
  snapshot. Accounts, organizations, the item master, every stock ledger,
  every recipe, every purchase order and all attendance records went with it.
  Loyverse was untouched — it holds the sales upstream — so reconnecting a POS
  token restores the whole dashboard. Nothing else came back.
- **`_store.js` prefers Postgres whenever `DATABASE_URL` is set**, falling back
  to Redis and then to an in-process Map. When both are configured Postgres
  wins outright rather than the two sharing the work: a key with two homes is
  a key with two answers. Redis remains supported for a deployment that has
  one and no database.
- The store's four functions are unchanged, so **no caller was touched**. The
  values are JSON documents read and written whole, with hand-rolled secondary
  indexes (`email:<address>` → username) that already work — modelling twenty
  of those into tables would mean rewriting twenty modules and the twenty-six
  test files that write fixtures through them, to fix a problem that is
  entirely about durability. Migration `004_app_state.sql` is the `kv` table:
  `key text PRIMARY KEY, value jsonb, updated_at`, plus a `text_pattern_ops`
  index because the primary key's own index cannot serve `LIKE 'inv:%'`.
  **This is a staging post, not a destination** — any one prefix can be
  promoted to a real table later without callers noticing.
- **`listKeys` escapes `%`, `_` and `\` in the prefix.** Unescaped, a prefix
  carrying a wildcard matches keys it does not name, which on the admin screen
  means listing somebody else's records. The `ESCAPE` clause needs `'\\'` in
  JavaScript source; written `'\'` it parses as an escaped quote and hands
  SQL an *empty* escape character, which silently disables the escaping. Both
  faults were shipped and caught by `_store-pg.test.js`.

## A configured store that fails must say so

- Every operation used to swallow its error: a failed read returned `null`
  (which is also what a missing key returns), a failed write returned `false`
  (which nothing checks), a failed scan returned `[]` — and below each sat a
  fall-through into the in-process Map. So a dead database presented as an
  empty, working app: sign-in said "wrong password", balances read as zero,
  and a delivery typed in at 7am returned 200 into memory belonging to one
  invocation.
- Now a configured backend that fails throws `StorageUnavailable`, and **the
  memory Map is reachable only when nothing is configured at all**.
  `handledUnavailable(res, err)` lives beside the error so no route can invent
  a different status — 503 with `Retry-After`, not 500, because the request
  was fine and will work later. Wired into `requireAuth`, `login` and
  `register`; the screens say `login.unavailable` / `register.errStorage` in
  all five languages and say explicitly that it is not the password.
- `recordAudit` and `noteSync` already catch, so best-effort logs still cannot
  fail the action they describe. Keep it that way.
- **Tests never touch the live store.** `scripts/test.mjs` deletes
  `REDIS_URL`, `KV_URL`, `KV_REST_API_URL`, `KV_REST_API_TOKEN` and now
  `DATABASE_URL`/`POSTGRES_URL` from the child environment. A file that needs
  the database calls `loadLocalEnv()` and opts back in — but that one variable
  also decides `_store.js`'s backend, which is how `_mirror.test.js` began
  writing olive-oil fixtures into the production `kv` table. It now calls
  **`__forceMemory()`**, a function rather than an environment variable on
  purpose: a variable that forces memory is a variable that can be set in
  production. `_store-pg.test.js` is the one file that exercises a real
  backend; it writes only under `selftest:` and deletes each key by name.
- Neon has no documented inactivity deletion and storage persists
  independently of compute, but the free plan's instant-restore window is only
  **6 hours** — keep a scheduled `pg_dump`.


## Verify it works
- `curl -sf -H "Host: external-preview.example.com" http://localhost:3000/`
  returns the HTML (Vite `allowedHosts: true`).
- `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/metrics`
  → `401` (proxy + auth working).
- Vite logs show live esbuild of `src/*.jsx` (serves source, not a build).

## Tests
- `npm test` → `npm run check` (imports, cycles, scroll containers,
  translations) then `node scripts/test.mjs`, which **discovers** every
  `api/*.test.js` and `src/**/*.test.mjs` and runs them in turn. 82 files.
- The list used to be written out by hand in the npm script. A merge kept both
  copies of that line and the older one won, so three test files existed,
  passed, and were never run while two deleted ones were still named.
  Discovering them removes the class of mistake; a new `*.test.js` is picked up
  by existing. `node scripts/test.mjs units` narrows to matching filenames.
- The runner **unsets `REDIS_URL`, `KV_URL`, `KV_REST_API_URL` and
  `KV_REST_API_TOKEN` in the child environment**, which is load-bearing rather
  than convenience: the tests write fixture accounts through `api/_store.js` and
  against a real Redis would write into live records. Each file also refuses to
  start unless `backend === "memory"`. Never run one directly inside the `api`
  container with Redis attached.
- This is also why the env vars are not set POSIX-style in the npm script any
  more. `REDIS_URL= node …` is shell syntax, npm runs scripts through `cmd.exe`
  on Windows, and the suite could not be run there at all.
- `api/_flow.test.js` is the only end-to-end one: a recipe written before
  anything is bought, an invoice that stocks it, a sale that draws it down. Its
  arithmetic is deliberately checkable on paper (5 kg at 114.00 → 22.80/kg; one
  150 g wrap leaves 4.85 kg), because the faults that reach people live between
  modules rather than inside them.

## Tills: the register, and Loyverse as an option
- **The register is the till.** Its receipts are `register:<org>:r:*`
  (`api/_till.js`). A business that already sells on **Loyverse** may connect
  it (Settings → Loyverse) instead of, or as well as, moving: its receipts are
  read from Loyverse's API and joined to the register's, so every report reads
  one list. Loyverse was taken out in `fe93839` and brought back as this option;
  the webhook, the deliveries feed and `stockSource: "pos"` were **not** brought
  back.
- `api/_loyverse.js` is everything Loyverse-specific: base URL
  (`LOYVERSE_API_BASE` overrides it, for a stand-in), Bearer token, cursor
  paging (250 a page, 40 pages / 20 s, then `truncated`), and `toReceipt()`,
  which turns a Loyverse receipt into a register-shaped one: `id` =
  `receipt_number` (edits and depletion are filed under it), `source:
  "loyverse"`, line `total_money` **less its ADDED taxes** (Loyverse's line total
  includes them; the register's does not), INCLUDED taxes stated as the
  receipt's effective `vat_pct` with `vat_mode: "inclusive"`, and Loyverse's
  item cost as `pos_cost` — used by `_aggregate.js` only **after** an owner's
  cost, a recipe and a product cost. Nothing from Loyverse is stored: it is
  their record.
- Reading: an in-process cache per token hash, fresh for 45 s; then only
  `updated_at_min` (2 min overlap) for what changed; the whole window again
  every 15 min. 402 = a plan with 31 days → read 30, remembered 6 h,
  `limitedHistory` (comparisons become null). A failure leaves the last read in
  place for up to 6 h with `error` set; not retried for 30 s; a 401/403 drops
  what was kept. `LoyverseError.code`: token, permission, plan, ratelimit,
  unreachable, upstream.
- The cache is per server instance, so each cold serverless instance walks the
  window again (up to ~20 s for a busy business). The routes that read sales
  have `maxDuration: 30` in `vercel.json` for that reason.
- `api/_possales.js` `posSalesFor(org)` finds the token, reads, ties stores and
  writes the sync log (a full walk, a failure once per 10 min, a recovery). It
  never throws: a failed read is `status.ok === false` with the reason.
- `registerContext()` / `salesReceipts(orgId, {since})` (`_till.js`) return the
  merged receipts plus `pos` (the till's status, null when none). Metrics,
  sales, variance, alerts, operations, the assistant (brief and the receipts /
  history tools) and the stock catch-up (`stock.js ?what=deplete-sales`) all
  read through them. Channels, shifts and customers stay register-only.
  `metrics.js` returns `pos` (also on the 409), shown by `src/TillBanner.jsx`
  and `EmptyTable`; the variance/alerts/plan screens get `sales.error: "pos"`.
- **Token** (`_accounts.js`): `setPosToken` keeps it encrypted on the owner's
  account (`posToken`, `posConnectedAt`; clearing sets `posOffAt`).
  `posTokenForOrg(org)`: owner's → a member's legacy one (members could paste
  their own before) unless the owner disconnected → the server's
  `LOYVERSE_ACCESS_TOKEN`/`POS_ACCESS_TOKEN` **only** for the business whose
  owner's email is `ADMIN_EMAIL` (it used to be every account's fallback, which
  would show one restaurant's sales to every sign-up). Stored tokens were never
  deleted, so **businesses connected before the removal are connected again**
  on their first read with no action. A token this server can't decrypt
  (`SESSION_SECRET` changed) reads as `lost` → "connect again".
- `PUT /api/account { posToken }` — owner only (403 `notowner`), tried against
  `/stores` first (422 `reason: token|permission`, 502 when Loyverse didn't
  answer), audit `pos.connect` / `pos.disconnect` (never the token), the
  operator is emailed. GET returns `pos` from `posOwnership` — never the token.
- **Stores** (`api/_stores.js`, key `org:<orgId>:stores`, route `api/stores.js`,
  UI `src/settings/StoresSetting.jsx`). Every business starts with one store
  under the id `register`. New stores get `s-<slug>` ids that never change on
  rename. Archived, never deleted; the last open store can't be archived. Each
  store's address, phone and TRN print on its own receipts. `rosterFor(account)`
  is the roster every scoped route resolves against. Owner (`manage:users`).
- **The first read of a business's store list writes it**, adopting every
  branch id it already has data under (`inv:<org>:moves:<id>` ledgers, members'
  assigned branches) as a store with that id, named "Branch N".
- `adoptStores(orgId, loyverseStores, { unused })` ties each Loyverse store to
  one of ours (`pos` on the store): the store with the same id (a business back
  from before — "Branch N" takes Loyverse's name), else the first store if it is
  untied (takes the name if still the default), else a new store under
  Loyverse's id. When every Loyverse store matched by id and the register never
  sold (`unused`), an untouched first store is archived so a 1-branch allowance
  unlocks the store with the sales. A different Loyverse account releases old
  ties. Runs on connect and on every read.
- Known limit: a business already selling on the register with a 1-branch
  allowance and **two** Loyverse stores sees the second locked until a branch is
  added to its plan.
- `vercel.json`: `usb=(self)` in Permissions-Policy (it was `usb=()`, which
  disabled WebUSB receipt printers on the site entirely), and
  `/api/itemimage` is cacheable, overriding the `/api` no-store.
- Tests: `api/_loyverse.test.js` (31 cases, 58 mutations caught). Trying it locally:
  run a stand-in on 127.0.0.1 and start the test server with
  `LOYVERSE_API_BASE=http://127.0.0.1:<port>/v1.0`.

## Network printers (LAN) from the website and the app
- One print job (`{ id, kind, printer, sheet, drawer, copies }`) goes through
  `src/print/PrinterService.js` → `PrintJobManager.js` (per-printer status,
  dedupe by id, `retry` flag) → an adapter: `LanBridgeAdapter` (website →
  queue → bridge), `NativePrintAdapter` (Capacitor), `WebDeviceAdapter`
  (WebUSB / Serial / Web Bluetooth), `BrowserPrintAdapter` (the dialog).
  Profiles (`src/print/profiles.js`) say what a model takes (port, raster,
  cut, drawer, status); **none is `verified: true`** — no real printer has
  been tested.
- Safari cannot open a socket, so a website print goes **PureMargin → queue
  (`api/_printqueue.js`, `api/print.js`) → print bridge → printer**. The
  bridge (`public/bridge/print-bridge.mjs`, Node ≥ 18, on a computer in the
  shop) only makes outbound requests; no printer port is exposed. Its token
  is `B.<org>.<bridgeId>.<sig>`, per bridge, revocable. Targets are allowed
  only on private IPv4, single-label or `.local` hosts, and only ones somebody
  with settings rights registered.
- Queue states queued → sending → printed | failed (`expired`, `unconfirmed`,
  and the printer's own reasons). `JOB_TTL` 90 s, lease 60 s, bridge online
  45 s, 3 MB cap. A job never printed twice under one id; the bridge also
  remembers printed ids on disk.
- The bridge asks the printer's status (DLE EOT) before and after: cover open
  or out of paper → nothing sent / failed. Close semantics: a job fails as
  `interrupted` only if the printer closed **before** the bridge hung up; a
  reset that arrives while closing, after every byte was written and a 250 ms
  settle, counts as sent (printers that RST on close would otherwise reprint).
- `--wait <s>` (0–25, default 20) is how long a claim is held open. Held open,
  a bridge keeps one serverless request running around the clock, which costs
  on wall-time-billed plans; `--wait 0` polls every 3 s instead. `api/print.js`
  has `maxDuration: 30` in `vercel.json`.
- Kitchen tickets record `printedOn[printerKey][lineKey]` only on success; the
  flat `printed` is the minimum over automatic kitchen printers that make the
  line, so a failed station is retried alone (`src/register/KitchenRetry.jsx`).
- On site (iCE IRP-200D at 192.168.8.19): `node print-bridge.mjs --probe
  192.168.8.19` finds the port, `--test 192.168.8.19:9100` prints a test page.
  From this Mac the address was unreachable (different subnet), so the
  protocol and port are **not** confirmed. `scripts/fake-printer.mjs` is the
  stand-in the tests and browser checks used.
- Tests: `api/_print.test.js`, `src/print/print.test.mjs` (68 mutations).

## Sales channels, low stock, offline
- **Channels** (`api/_channels.js`, `shared/channelmath.js`, route
  `api/channels.js`, screen `src/screens/Channels.jsx`): dated fee rules never
  overwritten, per-channel prices, every register order records its channel,
  the rule it was costed under and what it made. Register-only sales.
- **Low stock** in the bell (`_movements.js`, `src/notices.js`): out, under the
  reorder level, or under a fifth of the last delivery; one switch turns it off.
- **Offline, back office** (`src/offline.js`, `public/sw.js`): each read is kept
  as it arrives (on the device only for an installed app; memory in a tab;
  wiped on sign-out) and shown with `OfflineBanner`. Changes are not queued.
- **Offline, register** (`api/_tilloffline.js`, `src/register/api.js`): sales
  queue per signed-in person and replay with the receipt the till printed; the
  server prices them itself and records the till's figures only when it can't
  reach the same total (`price_source: "till"`, `review`, audit-logged).
  Points can't be spent offline. Tests: `api/_tilloffline.test.js`.

## Staff devices (register-only)
- Register → More → "Use as a staff register" (`manage:staff` or owner) calls
  `POST /api/till?what=device`, which returns a **device token**
  (`issueDeviceToken` in `api/_auth.js`): `R.<user>.<expires>.<version>.<sig>`,
  signed under its own `signScoped("device")` label so it can't be replayed as a
  session, stamped with the account's `tokenVersion` so "sign out everywhere"
  ends it, valid a year.
- **`requireAuth` refuses a device token on every route but `REGISTER_ONLY_ROUTES`
  (`till`)** with 403 `registeronly`. The check is in `requireAuth`, not in each
  route, so a new route is closed to devices without anyone remembering to.
- In `till.js`, on a device the account's capabilities don't apply: `can()` is
  true only for a manager PIN and only for `DEVICE_MANAGER_CAPS`. No PIN means
  cashier-level selling, no refunds, no settings.
- Client: `isDeviceToken` (`src/session.js`) makes `App.jsx` render `RegisterApp`
  with `deviceLocked` instead of the Shell. The way out is `UnlockSheet`
  (`src/register/DeviceLock.jsx`): signing in with the account password via
  `/api/login`, which replaces the device token with a normal session.
- Tests: `api/_device.test.js`.

## Variants and trading stock
- **Variants** live in two places and the register shows them the same way:
  - recipes that share a dish name and differ by `variant` (Recipes screen) are
    grouped by `catalogueOf` into one item; each variant is `r-<recipeId>` with
    that recipe's price, and the sale line's `item_id` is `recipe:<thatRecipe>`;
  - register variants (`settings.variants[itemId]`, `PUT /api/till?what=variants`,
    `readVariants`): `{ id, name, price, scale, barcode, sku }`. `scale` is how
    many portions of the plain recipe (or the product's stock draw) one is.
- `buildSale` (`shared/tillprice.js`) refuses a line without a variant when the
  item has them (`error: "variant"`), prices from the variant, writes
  `variant_id`/`variant_name`, and `variant_scale` only when ≠ 1.
- Depletion (`_salesdepletion.js`) resolves `recipe:<id>` directly, prefers a
  variant's own recipe by name over the plain one, and multiplies by
  `variant_scale` only when it fell back to the plain recipe. Variance does the
  same via `drawQty` on `salesLines` rows. A recipe index entry for a variant no
  longer overwrites the plain dish's name (it used to: last one listed won).
- **Trading stock**: a product (`saveProduct`) may carry `stock: { ingredientId,
  qty, unit }` — any unit of the stock item's dimension. `buildSale` writes
  `stock_draw` per unit sold onto the receipt line (so a later edit of the link
  doesn't rewrite past sales), and depletion takes it off the shelf with no
  recipe involved. `GET /api/till?what=stockitems` feeds the product form.
- `src/depletion.js` sent whole store objects as `branchId`; every catch-up
  depletion was refused 403. Fixed.
- Tests: `api/_variants.test.js`.

## Emailed receipts
- `POST /api/till?what=email { number, email, lang }` → `_receiptmail.js`
  `receiptMail()` → `sendMail`. The shop's name heads it; the selling store's
  address/phone/TRN win over the business's; a TRN makes it a tax invoice.
- **All wording is server-side** (`LABELS`, five languages). Only the address
  comes from the request — client-supplied labels would make this a way to send
  arbitrary text from our sender to any address. Everything is `esc()`'d.
- Limits in `allowSend`: 3 per receipt, 500 per business per day. 503
  `mailoff` when `RESEND_API_KEY` is unset (the local test server has none).
- Buttons: the paid sheet (disabled for an offline sale — nothing on the server
  to send yet) and the receipt detail. Prefilled from the customer's email.
- Tests: `api/_receiptmail.test.js`.

## Bluetooth printers
- Connection `bluetooth` in `src/print/printers.js`. Every raw-byte path now goes
  through `sendRaw()` (network, usb, serial, bluetooth), including the drawer.
- iOS (`ios/App/App/BluetoothPrinters.swift`, exposed by `PrinterPlugin` as
  `bluetoothScan` / `bluetoothSend` / `pickAccessory`):
  - **BLE** via CoreBluetooth: connect, discover every service, write to a known
    print characteristic (`PRINT_CHARACTERISTICS`: 2AF1, Feasycom, Microchip
    ISSC, FFxx) or else the first writable one — **never** in a firmware-update
    service (`NEVER_WRITE_SERVICES`). Packets sized by
    `maximumWriteValueLength`, flow-controlled by `canSendWriteWithoutResponse`.
  - **MFi** (Epson TM, Star) via ExternalAccessory, protocols
    `com.epson.escpos` / `jp.star-m.starpro` declared in Info.plist
    `UISupportedExternalAccessoryProtocols`. Star must be in ESC/POS emulation.
    Shipping MFi printing through the App Store needs the printer maker's MFi
    PPID submission — fine for development builds as is.
  - `NSBluetoothAlwaysUsageDescription` added. The manager is created lazily, so
    the permission is asked when someone looks for a Bluetooth printer.
- Web: Web Bluetooth (Chrome/Edge, not Safari), LE only, `BLE_SERVICES` must be
  listed up front as `optionalServices`.
- New Swift files go into the target with `scripts/ios/add-printer-plugin.rb`
  (needs CocoaPods' xcodeproj gem: `GEM_HOME="$(brew --prefix cocoapods)/libexec"`).
- Not tested against real Bluetooth hardware yet.

## Overview figures (audited)
- **No comparison is `null`, not 0.** `pctChange` returned 0 when the earlier
  period sold nothing, so a first week read "up 0.0%". Now null everywhere;
  `TrendIndicator` draws "—". Each overview range compares with the period just
  before it (today vs yesterday, week vs week) in `useDateRangeData`; the hero's
  30-day profit keeps the server's 30-day comparison.
- **Days and hours are the business's** (`org.timezone`, default Asia/Dubai) via
  `localParts` in `_aggregate.js`. They were UTC days and server-zone hours.
- **Dish costs come from recipes** (`menuCosts` in `_recipes.js`, the Recipes
  screen's own per-portion figure), then a variant's own recipe, then a
  product's `cost` on the receipt line, then the plain recipe × `variant_scale`,
  plus `addon_cost`. Before this the overview only knew hand-typed costs, so
  margins read 100% and profit purity never scored.
- **Profit is worked without VAT.** `totals.sales` stays what customers paid;
  `totals.tax` and `totals.salesExVat` are new; `grossProfit`, `marginPct`, item
  `marginPct` and net profit all use the ex-VAT base. Including VAT overstated
  gross profit by the whole VAT amount.
- `costCoverage` is line revenue with a known cost ÷ all line revenue, both
  ex-VAT (it was over receipt totals incl. VAT, so it could never reach 100%).
  `netProfit` takes it as a 0–1 share — it was handed the percentage, so its
  "upper bound" warning never showed. Item `marginPct` is null when uncosted.
- `costedMarginPct` = margin on the costed dishes only; profit purity
  (`pureScore`) scores that, not the headline margin that counts uncosted
  dishes as free.
- **Periods are calendar days**: the 30 days are today and the 29 before it
  (the days the chart draws), the comparison the 30 before that. They were
  30×24h back from now, and "prior" was everything older in the window. Daily
  sales keep fils (rounding each day first made them not add up); totals carry
  2 decimals so net profit and gross profit agree.
- Range labels say what they cover ("Last 7 days", "Last 30 days"), not "This
  week/month".
- **Longer history**: `GET /api/metrics?period=90|365|all`. The register keeps
  every sale, so `registerContext(account, { days })` reads 2×period (or from
  the first sale, `settings.usedAt` less a week, for `all` — never from 1970).
  `getMetrics` returns the usual 30 days plus `period: { key, days, from,
  bucket, series, totals }`; `bucketSeries` groups by day ≤ 92 days, week
  ≤ 400, month beyond. Profit, advice and the margin layer stay on 30 days
  (running costs are a 30-day window). `firstSaleAt` lets the screen say
  "Sales since …" when a range is longer than the history.
- The sales card says how much of it is VAT (`daily[].tax`).
- Tests: `api/_overview.test.js`.

## Item pictures, motion, and edge-to-edge frames
- **Pictures**: `PUT /api/till?what=image { itemId, image }` / `DELETE ?what=image&id=`
  (`manage:recipes`). Stored one per item at `register:<org>:img:<itemId>`
  (`_itemimages.js`), never inside settings — settings are read on every sale.
  Type is sniffed from the bytes (JPEG/PNG/WebP only), 400 KB cap; the device
  shrinks to a 480 px square JPEG first (`src/register/itemImage.js`).
- Served by **`GET /api/itemimage?o&i&v&s`** with no session (an `<img>` can't
  send one; a register-only device must still draw its menu). The HMAC
  (`_imageurl.js`, `signScoped("itemimage")`) covers org, item and version, and
  the version must be current, so a replaced picture's old address 404s and
  current addresses are `immutable`. `_imageurl.js` is separate so `_till.js`
  can sign without importing the storage module (which imports `_till.js`).
  `catalogueOf(recipes, settings, { orgId })` adds `image`; native resolves it
  against the API origin (`pictureSrc`). Tests: `api/_itemimages.test.js`.
- **Motion** (`index.css`): `sheet-in/out`, `backdrop-in/out`, `pane-in`,
  `line-in`, `bar-up`; sheets close through `useExit` (ui.jsx), which animates
  then calls `onClose` and restores itself if the caller refuses to close.
  All off under `prefers-reduced-motion`.
- **Edge to edge in the app**: `useAppFrame()` (`src/appFrame.js`) puts
  `app-frame-on` on `<html>` while the back office or register is mounted. In
  the native app that drops the body's safe-area padding and sets
  `--inset-top/--inset-bottom` to the real insets, so headers and tab bars
  extend behind the status bar and home indicator with their content clear of
  them. Pages that scroll as documents keep the old body padding.

## Multi-branch authorization (stage 1 of the product direction)
- `api/_org.js` — organizations, roles, membership, scope resolution. Every
  account owns an organization from registration (`orgFor` backfills accounts
  that predate this). Roles: `owner`, `ops`, `branch_manager`, `chef`,
  `accountant`; each has capabilities and a scope rule (`all` | `assigned`).
- **Branches are the business's own stores** (`api/_stores.js`, see *No
  outside till* below). Permissions only decide who may see which of those ids.
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

## Stock counts — removed
There was a full stocktake workflow here: `api/_counts.js`, draft → review →
approved, expected quantities snapshotted at open, one `adjust` movement per
line at approval, `approve:counts` withheld from the chef so that whoever
counted was not whoever signed it off. It is gone, and the reasoning is worth
keeping so it is not rebuilt by someone who only sees the gap.

It was a faithful implementation of how stock control is done on paper, and it
asked a kitchen to do the most tedious job in the building on a schedule, for a
number the system can already derive: **stock = deliveries in − what the sales
consumed**. Both sides of that now exist and are trustworthy — invoices arrive
by camera or PDF and are committed in one press, and `_salesdepletion.js` posts
consumption per receipt, idempotently.

What actually goes with it:
- `approve:counts` is gone from every role. The separation it enforced now
  lives on reversal, which `api/stock.js` holds behind `manage:users` — somebody
  who can both create and cancel entries can make a discrepancy disappear.
- The five `count.*` audit keys are gone from `AUDIT_ACTIONS`. Rows already
  written keep rendering: `AuditLog` shows `actions[e.action] || e.action`.
- Leakage. With automatic depletion on, `actual` and `theoretical` are derived
  from the same sales and variance reads zero — the count sheet used to be
  where you got a real answer. That trade-off is stated on the switch and is
  unchanged by this; the honest position is that leakage needs somebody
  recording issues, not a periodic recount.

## What one of something is (`api/_conversions.js`)
- An ingredient carries `conversions`: "one `from` is `qty` `unit`", where
  `from` is a ledger unit of another dimension ("1 ea = 0.1 kg" for a lemon) or
  a word ("1 tin = 18 l", "1 clove = 5 g"). This is the density `_units.js`
  says belongs to the ingredient; `_units.js` itself still never converts
  across dimensions.
- **The model supplies them.** Both prompts now list items as `name | unit`,
  and a line whose unit cannot reach the shelf's by arithmetic carries
  `convert`. The invoice prompt may also estimate a package nothing printed
  (`pack.estimated`). Estimated is the default unless the model says
  `estimated: false`; rows show it in amber, the way an estimated cost shows.
- `toShelf` order: same-dimension arithmetic (never overruled) → the item's
  own package word → a printed conversion → a kept one → an estimated one.
- **Learned on save, never on scan** — a delivery received
  (`stock.js ?what=invoice`) or a recipe saved (`saveVersion`). A printed
  conversion replaces an estimate; an estimate replaces only an estimate.
  `saveIngredient` keeps them through a form edit that does not mention them.
- `buildPurchase` converts against the *proposed* shelf for a line with no
  match. It used to convert only against a match, so every new item sold by
  the jar, tin or pack was refused on a first delivery (8 of 19 lines on
  a sample delivery note).
- A new item's `packSize` of 1 is the default, not an answer: only
  `packKnown` lets it convert a package.
- Tests: `api/_conversions.test.js` (21).

## Supplier vocabulary (`api/_aliases.js`)
- Key `inv:<orgId>:aliases`: normalised invoice description → `{ ingredientId,
  hits, learnedAt, replaced }`. Capped at 5000, trimmed by least-used.
- **Learned on commit, never on parse.** A parse is a proposal; committing is a
  person saying the proposal was right. Learning from a parse would make a
  wrong guess permanent on the strength of nothing.
- Read first in `buildPurchase`'s match chain, ahead of the model's named pick
  and token overlap, because an alias is a decision and the others are guesses.
  Lines resolved this way carry `viaAlias: true`.
- **An alias whose ingredient no longer exists resolves to nothing.** Checked on
  read against the live id set rather than by deleting, since the ingredient may
  be archived rather than gone; `pruneAliases` is the write path.
- `resetInventory` clears the table — every alias would otherwise point at
  something that no longer exists.
- Tests: `api/_aliases.test.js` (12).

## Scanned invoices → stock (`api/_purchase.js`, `POST /api/stock?what=invoice`)
- Camera or PDF in, a committed delivery out, in one press. `api/ai.js` reads
  the document; `buildPurchase` matches each line and derives the figures;
  `?what=invoice` creates missing ingredients, receives every line and learns
  the supplier's wording, in that order.
- The browser used to do those three as separate calls — create, re-attach the
  new ids, then receive — each able to fail alone, with no way to finish from
  the state a failure left. The set is validated (`dryRun`) before the ledger
  moves.
- **`receiveQty`/`receiveUnit` are the pair that goes to the ledger, and they
  exist because getting this wrong is silent.** `unitCost` is restated into the
  unit the *shelf* keeps (114 for 5 kg of something held in grams is 0.0228 a
  gram) while `qty`/`unit` stay as the invoice printed them. Passing the printed
  pair with the restated cost makes `recordMovement` divide by the conversion a
  second time — chicken recorded at 0.0228 a kilo instead of 22.80, a thousandth
  of the truth, in the direction that makes food cost look wonderful. Never mix
  them. Editing a quantity or unit by hand must clear both.
- Unit cost is always **derived** (line total ÷ quantity), never read off the
  invoice: the per-unit figure a supplier prints is rounded for display.
- `totalsOf` takes subtotal/tax/total as printed and derives only what is
  missing — the two known ones always give the third. **A total on its own is
  never split by an assumed VAT rate**; 5% is the UAE rule, not everyone's, and
  a number that looks read off the paper but was assumed never gets questioned.
  `totalsAgree` is false when the three do not reconcile, which the card shows
  as a caveat rather than a refusal.
- The screen (`src/ai/SupplierScan.jsx`) asks nothing it can work out: no
  ingredient dropdown, no unit box, no cost field. It states the invoice header
  and offers Save and Cancel. Cancel touches nothing — the draft only ever
  existed in component state. The editable line list is one press away, closed
  by default.

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
  - An ingredient no delivery has priced falls back to
    `ingredient.estimatedCostPerBase`, flagged `estimated: true` through
    `evidenceFor` and out to the screen. **Fallback only** — one real invoice
    beats any estimate, so it stops applying the moment a receipt exists,
    without anyone clearing it out. An ingredient with neither is still `null`.
- `api/_recipes.js`, key `inv:<orgId>:recipes`. Recipes are org-level master data;
  **cost is local**, from the authorized branches' ledgers.
- **A recipe line may name an ingredient that does not exist yet.** `buildLines`
  used to refuse with `{ error: "ingredientId" }`, which the screen showed as
  "item not found in inventory" — so a recipe could not be written until the
  inventory had been done, which is backwards from how a menu is planned. An
  unresolved name now goes to `ensureIngredient(orgId, …)`, which matches on the
  same slug ids use (so "Olive oil" and "OLIVE OIL" are one), revives an
  archived match rather than duplicating it, and otherwise creates the item from
  the line's own unit and `estimatedCost`. `saveVersion` returns
  `newIngredients[]` so the screen and the audit log can say what was created.
  Still refused: no name at all, a non-positive quantity, a unit of the wrong
  dimension, the same ingredient twice.
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
## What the assistant can read
- **Tools read the branches the stock screen reads.** `askerScopeFor` in
  `api/chat.js` resolves scope from `rosterFor`, as `stock.js` does. It used
  to be `scopeFor(account, [])`, so every tool walked zero branches: the
  storeroom read as empty, movements and purchase orders as none, recipes
  costed from estimates only.
- **Packages gate the tools as they gate the screens.** `TOOL_FEATURE` in
  `_domains.js` mirrors `SCREEN_FEATURE` (asserted in `_askstock.test.js`);
  `toolsFor(features)` offers only the paid ones and `runTool` refuses the
  rest by naming the package. No `features` fails closed.
- `get_stock_alerts` narrows a model-supplied branch list with
  `effectiveBranches`; it used to take it as given.
- The brief has a **STOCK ON HAND** section (operations, `view:inventory`):
  largest value first, capped at 40, reorder and negative states named.
- **No till is not a refusal.** A business with no POS and no register sales
  used to get 409 before anything was read; it now gets "SALES: none" and
  everything else it has.

## The dry run is an option, not a field
- `recordMovement(orgId, branchId, input, { dryRun })`. `stock.js` passed
  `dryRun` inside `input` on the invoice, receive-batch and consume routes, so
  every check was a real, concurrent write: one phantom entry (usually)
  survived per save, and the Postgres mirror got all of them. Fixed; tested
  in `_dryrun.test.js`. Ledgers written before the fix still hold the extras.

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

## Routing (`src/router.js`)
- Screens are addresses in the hash: `#/` landing, `#/login`, `#/register`,
  `#/forgot`, `#/pricing`, `#/admin`, and `#/app/<tab>` for every dashboard tab.
  Hash routing on purpose — deep links work with no host rewrite to maintain.
- `navigate(path)` pushes (so Back returns); `{ replace: true }` is for
  corrections the user didn't choose (normalising an unknown route, sending a
  signed-in session back to the app) which must not become a stop on the way back.
- `pushState` never fires `hashchange`, so `navigate` dispatches `sufra:route`;
  `useRoute` listens to that plus `hashchange` and `popstate`.
- `useBackspaceBack` (mounted once in `App.jsx`) makes Backspace go back, unless
  the keystroke is editing text (input/textarea/select/contenteditable).
- `Shell.jsx` derives its tab from `#/app/<tab>` and validates it against
  `SCREEN_FEATURE`, so an unknown tab opens the dashboard, not a blank pane.

## Admin panel
- `#/admin` → `src/AdminPage.jsx` (it was written but never routed to before).
  Its own sign-in, its own 30-minute token; an app session is never accepted.
- Access = `ADMIN_EMAIL` (from the environment, can't be removed through the API)
  plus the addresses in the `admins:extra` key, managed from the panel itself.
- Strings live in `src/i18n-admin.js`, merged into the dictionary as `t.admin` by
  the language provider — operator-only wording, kept out of the big file.
- `api/_accounts.js` was missing `PLAN_MONTHS` entirely, which crashed the whole
  API server on import of `admin.js` (every route 500). `FEATURES` also lacked
  `operations` and `billscan`, so those two packages could not be granted at all.

## Cost ledger, sale corrections and packages (this pass)
- **Cost screen is a typed ledger, not a scanner.** `src/screens/Costs.jsx` +
  `src/costs/{CostModal,CostRow}.jsx`. Fixed costs keep the old
  `api/_fixedcosts.js` store (`monthlyEquivalent`/`monthlyTotal` added for the
  header); variable costs are new in `api/_varcosts.js`, key `varcosts:<orgId>`.
  **Dates are `YYYY-MM-DD` strings, never timestamps** — held as ms and read back
  as UTC, an evening spend on the 31st in Dubai lands in the next month and the
  total stops matching the list under it.
- A fixed cost offers **both** end-from-today (keeps costing the months it ran)
  and delete (for an entry that was never true). A variable cost only deletes.
- **Customer bill scanning is gone.** The `bill` kind is out of `api/ai.js` and
  `api/_docroute.js`; `_depletion.js` and `DepletionPanel.jsx` are deleted. A
  diner's bill classifies as `unknown`. It made a second copy of a transaction
  the POS already held with nothing to reconcile the two. Do not re-add it.
- **`api/_saleedits.js` is the replacement**, key `sales:<orgId>:edits`. An
  overlay keyed by receipt id: nothing upstream is mutated, so every correction
  is reversible and `original` survives beside it. Voiding flags, never deletes.
  Line edits carry tax/service across proportionally. `isStale` reports a
  correction whose basis moved — never resolves it, only a person knows which
  figure is now right. Capability `adjust:sales`; **the cashier deliberately
  lacks it.** Applied inside `getMetrics`/`salesLines` so one void reaches every
  series, not just the headline. Front end `src/screens/Sales.jsx` +
  `src/sales/SaleEditDialog.jsx`.
- **Three packages**: `assistant`, `operations`, `costs`. `billscan`/`menu`/
  `forecast` forward to `costs`, `pos_hardware` to nothing, via `LEGACY_FEATURES`
  in **both** `api/_accounts.js` and `src/entitlements.js` — `_packages.test.js`
  asserts the two maps agree. Translated on read, never written back. Extra
  branches are a percentage (`BRANCH_SURCHARGE_PCT`) and hardware is quoted per
  order; neither is a grantable id.
- **`scripts/check-i18n.mjs`** fails the build on a dictionary block missing from
  a language. It found Arabic/Hindi/Tagalog missing six `overview` keys and
  Hindi/Tagalog missing the whole `reset` block — the forgot-password flow was
  blank in two languages. It also **warns on duplicate blocks**: the note below
  calling those harmless is wrong, the later declaration wins outright and every
  key unique to the earlier one is dead.

## Notes
- `vite.config.js` was extended with `host`, `allowedHosts: true`, and the
  `/api` proxy — needed to run outside Vercel. Original had only `port: 5173`.
- `server.js` and `.env.base44-defaults` are new, dev-only.
- i18n.jsx emits duplicate-key warnings (pre-existing, harmless).
