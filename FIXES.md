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

# Second pass

A full re-audit after the first round shipped. The analyzers came back clean —
no undefined identifiers, no missing translation keys, no duplicate keys, no
hook-order problems — so this round is gaps and hardening rather than repair,
with one exception.

## 12. Sign-in accepted unlimited password guesses

`api/login.js` had no throttling of any kind. The reset flow caps attempts at
five and the admin panel pauses 600ms on a bad password, but the front door —
the one that issues a session token — did neither. An account password was
only as strong as the time an attacker was willing to spend, and nothing in
the logs would have looked unusual.

Added `api/_throttle.js`: eight failures against one identifier within fifteen
minutes closes it, and the endpoint answers 429 with `Retry-After` instead of
checking the password at all. A correct password clears the run immediately.

Three details that matter:

- **The window runs from the first failure, not the last.** Extending it on
  every attempt would let a slow trickle of guesses hold somebody out of their
  own account indefinitely.
- **Counting is per identifier, not per IP.** An attacker spraying one password
  across many accounts is a different problem wanting different handling; this
  stops the case that actually breaks a single account, and changing address
  doesn't sidestep it. The cost is that somebody who knows your email can lock
  you out for the window — which is why it is fifteen minutes, not a day.
- **Identifiers are matched case- and whitespace-insensitively**, so
  `Owner@Example.com` and `  owner@example.com  ` count against the same total.

Ten tests in `api/_throttle.test.js` cover the ceiling, expiry, window
behaviour, clearing on success, and both normalisation cases.

The UI showed "check the password and try again" for every failed response,
including a lockout, so a locked-out person would keep guessing into a wall.
`Login.jsx` now reads the 429 and shows a new `login.tooMany` string with the
wait in minutes, in all four languages.

## 13. A guard so the Plan-tab bug cannot come back

`scripts/check-imports.mjs`, wired into `npm test` and runnable as
`npm run check`. No dependencies — it runs anywhere node does. Three checks:

1. every relative import resolves to a file that exists
2. every named import is actually exported by that file
3. no call site uses a name some module in this project exports, unless the
   file imports or declares it

The third is the one that matters, and it catches the original bug exactly:
reverting `BranchRanking.jsx` to its broken state produces

```
FAIL src/plan/BranchRanking.jsx: "fill" is used but never imported or declared (line 33)
```

It is deliberately narrow, firing only on names the project itself exports.
A typo'd browser global slips through, but it cannot cry wolf about ordinary
local variables — and a checker that fails the build on noise gets switched
off. Verified: zero findings across all 146 files in their current state.

This replaces the earlier recommendation to add ESLint. ESLint's `no-undef`
would also have caught it, but it needs a dependency, a config, and a decision
about every other rule it brings. This is thirty seconds of setup and one
job done well.

## 14. Shared links had no preview image

`index.html` declared `twitter:card` as `summary_large_image` but supplied no
image, so a link posted to WhatsApp, Twitter or LinkedIn rendered as a bare
grey box. Added `public/og-image.png` — 1200x630, generated from the same logo
constants as the icons — plus `og:image`, `og:image:width`, `og:image:height`,
`og:image:alt`, `og:url`, `og:site_name`, `twitter:image` and a canonical link.

The card carries the mark alone rather than the wordmark, because the brand
display face (Space Grotesk) is a webfont and substituting a different one
would have shipped an off-brand image.

## 15. No security headers

The deployment sent none. `vercel.json` now sets, on every response:

| Header | Value | Why |
| --- | --- | --- |
| `X-Content-Type-Options` | `nosniff` | Stops MIME-sniffing an upload into a script |
| `X-Frame-Options` | `DENY` | The app can't be framed, so it can't be clickjacked |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Keeps paths out of third-party referer logs |
| `Permissions-Policy` | geolocation, microphone, payment, USB off | Nothing here needs them |
| `Strict-Transport-Security` | 2 years, subdomains, preload | Forecloses downgrade attempts |

`/api/*` also gets `Cache-Control: no-store` and `X-Robots-Tag: noindex`, and
`/assets/*` gets a one-year immutable cache, which is safe because Vite
fingerprints those filenames.

**No Content-Security-Policy.** It is the header that would help most, but the
app loads webfonts from Google Fonts and this build has inline styles
throughout, so a CSP written blind would either break the site or be so loose
it achieves nothing. Worth doing deliberately, with the deployed site in front
of you, rather than guessed at from source.

## 16. Crawler files

Added `public/robots.txt` (allows the site, disallows `/api/`, points at the
sitemap) and a minimal `public/sitemap.xml`. The signed-in app lives behind a
session so there is nothing else for a crawler to reach.

## 17. `puppeteer` moved to devDependencies

It was a production dependency whose only consumer is `check_errors.cjs`, a
leftover debug script, so every install pulled a full Chromium — including
every Vercel build.

**Run `npm install` once locally and commit the updated `package-lock.json`**,
so the lockfile matches. Vercel's `npm install` reconciles it either way, but
`npm ci` would fail on a mismatch.

## 18. `decision.title` said something different in Arabic

English, Hindi and Tagalog all used the kitchen; Arabic said
واجهة المشروع — the front of the business. Arabic now reads
أنت تعرف مطبخك, matching the other three.

Note the mild tension with fix 10: the lead says تصنع (make) rather than
تطبخ (cook), while the title now says مطبخك (your kitchen). That is
defensible — the title names the place they know, the lead avoids prescribing
the craft — but if you would rather move the whole section away from kitchens,
all four titles need changing together, not just the Arabic.

---

## Verified clean

- All 12 test suites pass, including the new import check and throttle tests
- Every `.js` file passes `node --check`
- No unresolved imports; no missing named or default exports
- No JSX component used without an import
- No React hook called after an early return
- Every `/api/*` endpoint the frontend calls has a matching handler
- No duplicate keys, missing i18n keys, or encoding corruption
- All config files present and valid JSON

## Still worth doing

1. **A Content-Security-Policy**, written against the deployed site. See 15.
2. **A service worker.** The manifest declares `display: standalone`, so the
   app installs and opens chromeless — but with no network it shows the browser
   error page, which is jarring for something that presents itself as an app.
   An offline shell is a contained addition.
3. **Delete `check_errors.cjs`.** It has a hardcoded Chrome path
   (`/root/.cache/puppeteer/chrome/linux-127.0.6533.88/…`) and hardcoded test
   credentials. Removing it drops the last reason to keep puppeteer at all.
4. **`src/i18n.jsx` is over 5,100 lines** and every language ships to every
   visitor. Splitting per language behind a dynamic import would cut what a
   first-time visitor downloads by roughly three quarters. Worth doing when
   the file next needs restructuring, not before.
