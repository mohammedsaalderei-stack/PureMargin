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

## 7. `MAIL_FROM` validator accepted a malformed sender — Resend 422

`api/_mail.js` has a guard meant to reject a badly-formed `MAIL_FROM` and fall
back to Resend's shared sender. It let `<anything>@riafdoluu.resend.app`
through, and Resend refused the whole send:

```
"name": "validation_error",
"message": "Invalid `from` field. The email address needs to follow the
            `email@example.com` or `Name <email@example.com>` format.",
"statusCode": 422
```

Two things combined. The extraction regex `<([^>]+)>\s*$` anchors the closing
bracket to the end of the string, so with the brackets in the middle it didn't
match and the raw string was validated instead. And the validator's character
classes `[^\s@]` don't exclude `<` or `>`, so `<anything>` was accepted as a
local part.

Excluded angle brackets from all three classes:

```js
- if (/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(address.trim())) return configuredFrom;
+ if (/^[^\s@<>]+@[^\s@.<>]+\.[^\s@<>]+$/.test(address.trim())) return configuredFrom;
```

A malformed sender now falls back with a logged warning instead of costing
somebody their reset code.

The underlying cause was configuration: `<anything>` is a placeholder from the
Resend dashboard meaning "choose a mailbox name", copied in literally. With
`puremargin.ae` verified, set:

```
MAIL_FROM=PureMargin <noreply@puremargin.ae>
```

## 8. Undocumented mail and POS environment variables

`RESEND_API_KEY`, `MAIL_FROM`, `MAIL_REPLY_TO`, `FEEDBACK_EMAIL_TO`,
`POS_ACCESS_TOKEN` and `POS_API_BASE` are all read by the code but appeared
nowhere in `.env.example` — the same gap that hid `ADMIN_EMAIL`, and the reason
the sender placeholder was guessed at rather than looked up. All six are now
documented, with the `MAIL_FROM` entry calling out the placeholder trap
specifically.

## 9. Invitation links carried the wrong domain

`api/team.js` built the invite URL from the request headers:

```js
const origin = req.headers.origin || (req.headers.host ? `https://${req.headers.host}` : "");
```

Whatever host the inviter happened to be on went into someone else's inbox —
a preview build, or the project's `*.vercel.app` address. The link worked but
didn't look like the product, and a preview URL stops resolving once that
deployment is rotated away.

Replaced with a `publicOrigin(req)` helper that prefers a new `APP_URL`
environment variable, tolerates a missing scheme or a trailing slash, and
falls back to the old header-derived behaviour when unset, so a deployment
that hasn't configured it still sends a working link.

Set `APP_URL=https://puremargin.ae`.

This was the only place in the codebase building a URL from request headers.

## 10. `decision.lead` was truncated in three languages

Arabic carried the full three-part line; English, Hindi and Tagalog had only
the opening sentence, so the section lost its point mid-thought. Completed all
three, and changed the Arabic verb from تطبخ (cook) to تصنع (make) so the line
isn't restricted to kitchens. Also added a diacritic to بِيع, which without it
reads ambiguously as the noun "sale" rather than the passive "was sold", and
corrected عادة to عادةً.

## 11. App icon replaced, and iOS never had one

The home screen icon is now the logo mark — the bar, dot, block and M — drawn
from the wordmark. Geometry was measured off the supplied logo into a 206x112
mark space and used to generate both the SVG and every PNG from the same
constants, so the vector and raster copies cannot drift.

Separately, `index.html` pointed `apple-touch-icon` at `/icon.svg`. **iOS does
not accept SVG for `apple-touch-icon`** — Safari needs a PNG. Anyone adding the
app to an iPhone home screen got a screenshot of the page rather than an icon.
That is fixed, and it is probably the reason the icon looked wrong in the first
place.

The manifest also declared a single SVG with `"purpose": "any maskable"`. One
image cannot serve both well: a maskable icon is cropped to a circle covering
the central 80%, so an icon drawn to fill the tile loses its edges, while one
padded for the crop looks small everywhere else. They are now separate entries.

| File | Size | Role |
| --- | --- | --- |
| `icon.svg` | vector | Favicon and any-purpose manifest icon |
| `icon-192.png` | 192 | Android home screen, standard |
| `icon-512.png` | 512 | Android splash and install prompt |
| `icon-maskable-512.png` | 512 | Adaptive icons, padded to the safe zone |
| `apple-touch-icon.png` | 180 | iOS home screen |

The maskable variant was checked programmatically: its furthest mark pixel sits
184px from centre against a 204.8px limit, so nothing clips under any mask
shape. The iOS icon is full-bleed opaque RGB with no rounding of its own, since
iOS applies its own squircle and rounding it twice leaves pale corners.

Tile colour is `#08060E`, matching `background_color` so the icon blends into
the splash screen rather than showing a seam.

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
