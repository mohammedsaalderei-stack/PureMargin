# Fixes applied

Audit of the whole tree, 24 Aug 2026. Ten files changed. All 11 API test
suites still pass; every `.js` file still parses.

---

## 1. Six missing `fill` imports — crashed the screen

`fill()` is a named export of `src/i18n.jsx` that substitutes `{placeholders}`
in translation strings. Six components called it while importing only
`useLang`. Modules don't inherit their parent's imports, so `fill` was an
unresolved identifier and threw `ReferenceError: fill is not defined` the
moment the component rendered — caught by `ErrorBoundary` and shown as
"This screen didn't load".

| File | Crashed when |
| --- | --- |
| `src/plan/BranchRanking.jsx` | **The Plan tab, on any branch ranking row** |
| `src/alerts/AlertCard.jsx` | Any alert renders |
| `src/variance/VarianceRow.jsx` | A variance row has movements |
| `src/recipes/RecipeSheet.jsx` | A recipe sheet opens |
| `src/recipes/RecipeForm.jsx` | Editing an existing recipe |
| `src/screens/Recipes.jsx` | A recipe has a version number |

Each import line now reads `import { useLang, fill } from "../i18n.jsx";`.

`RecipeForm.jsx` was the sneakiest: the call sits behind a ternary
(`recipe ? fill(s.editing, …) : s.newRecipe`), so creating a recipe worked
and only editing one failed.

## 2. Missing `t.aiscan` section — crashed Bill scan

`src/ai/PhotoScan.jsx` does `const s = t.aiscan`, but no `aiscan` section
existed in the dictionary. `s` was `undefined`, so reading `s.analyzing` in
the render body threw a `TypeError`.

`PhotoScan` is rendered by both `src/screens/Costs.jsx` (Bill scan) and
`src/ai/InventoryScan.jsx`, so **the Bill scan tab was broken in exactly the
same way as Plan.**

Added `aiscan` with `locked`, `failed`, `analyzing`, `retake` and `take`, in
all four languages.

## 3. Missing translation keys — blank labels

Undefined renders as nothing in JSX, so these were silent gaps rather than
crashes.

- **`team.*` (8 keys)** — the Team screen was rewritten for email invitations
  but the strings were never added; the section still carried only
  `usernamePlaceholder` and `add` from the old username flow. Added
  `joinedNow`, `inviteSent`, `pendingTitle`, `pendingNote`, `revoke`,
  `emailPlaceholder`, `invite`, `planNote`.
- **`menu.byRevenue`** — used at `src/screens/Menu.jsx:330`.
- **`billing.active`** — used at `src/screens/Plans.jsx:72`.

All added in `en`, `ar`, `hi` and `tl`.

## 4. Stale `team.addNote` copy

English, Hindi and Tagalog still read "use the username they sign in with"
while the field is an email input. Arabic had already been updated. Corrected
the other three to describe the invitation flow.

## 5. Corrupted duplicate key in the Hindi block

`advice.risk` appeared twice, at lines 3528 and 3530. The first was a
truncated fragment ending in a literal U+FFFD REPLACEMENT CHARACTER, spliced
onto the tail of the preceding `caution` string. The later definition
silently won, so it never surfaced at runtime, but it was dead corrupt data
and the file's only duplicate key. Removed.

## 6. `ADMIN_EMAIL` was never configured — locked you out of `#/admin`

`api/admin.js` derives admin access entirely from `process.env.ADMIN_EMAIL`.
Unset, `adminEmails()` returns `[]`, `isAdminAccount()` returns `false` for
every account, and login returns 401 `credentials` — deliberately identical
to a wrong password, so the UI just says the details are bad. It is a closed
loop: `addAdmin` requires an existing admin session, so with no bootstrap
admin there is no way in through the API at all.

The variable was referenced in `api/admin.js`, `api/account.js:76` and
`AGENTS.md:448`, but declared nowhere — not in `.env.example`, not in
`.env.base44-defaults`, and not in the `secrets` array of
`.base44/environment.json`. Since the platform only injects declared secrets
into `/run/base44/app.env`, it never reached the container.

Now declared in all three places, with an empty value you must fill in.

### To actually get in

1. Register an account normally with the address you want to use.
2. Set `ADMIN_EMAIL` to that address:
   - **Local / Docker** — put it in `.env.base44-defaults`, then
     `docker compose -f docker-compose.base44.yml up -d --force-recreate api`
   - **Vercel** — set it in the project's environment variables and redeploy
   - **Base44** — it now appears as a declared secret
3. Go to `#/admin` and sign in with your username or email plus your password.
   The panel won't accept your existing app session; it mints its own
   30-minute token.

Case and surrounding whitespace don't matter — both the stored email and the
env var are lowercased and trimmed.

---

## Verified clean

- All 11 API test suites pass
- Every `.js` file passes `node --check`
- No unresolved imports; no missing named or default exports
- No JSX component used without an import
- No React hook called after an early return
- Every `/api/*` endpoint the frontend calls has a matching handler
- No remaining duplicate keys, missing i18n keys, or encoding corruption
- `vite.config.js`, `tailwind.config.js`, `vercel.json` all present and valid

## Recommended, not applied

`package.json` was left untouched so it stays in sync with
`package-lock.json`. Two things worth doing yourself:

1. **Add ESLint.** All six `fill` bugs would have been caught instantly by
   `no-undef`. This is the single change that stops the class of bug that
   broke your Plan tab from recurring — nothing in a Vite build catches an
   unresolved bare identifier, because it compiles to a global lookup that
   only fails at runtime.
2. **Move `puppeteer` to `devDependencies`.** It's a production dependency
   today, so it pulls a full Chromium on every install, including on Vercel.
   Its only consumer is `check_errors.cjs`, a leftover debug script with a
   hardcoded Chrome path
   (`/root/.cache/puppeteer/chrome/linux-127.0.6533.88/…`) and hardcoded test
   credentials. Consider deleting that script too.
