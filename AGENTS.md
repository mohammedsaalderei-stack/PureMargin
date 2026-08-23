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
- `npm test` → `api/_org.test.js` (stage 1 authorization: roles, branch scope,
  isolation). It writes fixture accounts through `api/_store.js`, so it refuses
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

## Account deletion
Two paths, both on `DELETE /api/account`:
- default — `requestDeletion`, a 7-day grace window, undoable with `POST`.
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
