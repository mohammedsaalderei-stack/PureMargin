# Sufra · سفرة

*Everything on the table.*

Sales intelligence for restaurants, cafés, and cloud kitchens. Connects to a Loyverse POS, shows what happened, and answers questions about it in plain language.

**Arabic by default**, English one tap away. Four screens behind a login, plus a public page explaining the product:

- **Ask** (اسأل) — questions in either language, answered from your own sales, streamed as they're written
- **Watch** (راقب) — sales, orders, average ticket, branches, busiest hours, top items, plus generated observations
- **Menu** (القائمة) — menu engineering: every dish placed in one of four quadrants
- **Forecast** (استشرف) — next 30 days as a range, with cautious, likely, and good cases

---

## Deploy

1. Push this folder to a GitHub repo. **`package.json` must sit at the top level of the repo**, not inside a subfolder.
2. In Vercel: **Add New → Project → Import**. It detects Vite automatically.
3. Add environment variables (Settings → Environment Variables):

| Variable | Required | What happens without it |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Ask returns a clear error; other screens work |
| `LOYVERSE_ACCESS_TOKEN` | No | Runs on sample data, labelled "Demo" in the UI |
| `APP_PASSWORD` | No | Any password signs in |
| `SESSION_SECRET` | No | Falls back to `APP_PASSWORD` |

4. Deploy.

Never prefix these with `VITE_`. That prefix bundles the value into the JavaScript sent to browsers, exposing your keys to anyone who opens dev tools.

## Run locally

```bash
npm install
npx vercel dev      # runs the site and the API together
```

`npm run dev` serves only the front end — the `/api` routes won't exist, so sign-in will fail. Use `vercel dev` for the whole thing.

## Desktop and touch layouts

One codebase, two real layouts, switching at 1024px:

- **1024px and up** — fixed left sidebar, multi-column dashboard, wider charts
- **Below 1024px** — top bar and bottom tab bar, single column, larger touch targets

iPads in portrait (768–1024px) get the touch layout with a two-column metric grid; in landscape they get the desktop layout. This is deliberate — one app that adapts beats two codebases drifting apart.

## Where things live

| Path | Purpose |
|---|---|
| `src/Landing.jsx` | Public page — hero, sources, capabilities, steps |
| `src/Login.jsx` | Sign-in, calls `/api/login` |
| `src/Shell.jsx` | Layout switch, navigation, data loading |
| `src/screens/` | Ask, Watch, Forecast, Settings |
| `src/theme.js` | Colours and formatters |
| `api/_auth.js` | HMAC-signed session tokens, 7-day expiry |
| `api/_data.js` | Loyverse fetch, aggregation, forecast, sample fallback |
| `api/chat.js` | Talks to Claude with your numbers as context |
| `api/metrics.js` | Returns the dashboard data |

## How the forecast works

Compares the last 14 days against the 14 before, derives a daily growth rate (capped so a single good week can't produce a runaway projection), and projects forward. The band widens from ±12% on day 1 to ±34% on day 30, because a month out genuinely is less certain. It assumes no change to menu, prices, or hours.

## Getting a Loyverse token

Loyverse Back Office → **Integrations** → **Access tokens**. One token covers one business.

## Honest limits of this version

- **One business per deployment.** Multi-tenant needs a database and per-café OAuth.
- **Shared password, not user accounts.** Fine for an internal tool or a demo; not for customers.
- **No margin or profit.** Receipts carry revenue, not cost. Reading item costs from the Loyverse item list would fix this.
- **Bilingual.** Full English and Arabic, with real RTL layout. The language toggle sits in the landing nav, the login screen, and Settings; the choice is remembered. Charts stay left-to-right in both languages, which is standard for time-series.
- **Sample data is clearly labelled** as "Demo" in the header and Settings, so nobody mistakes it for real trading.

## Naming and copy

**Sufra** (سفرة) is the laid table — everything set out and visible. Same word in both languages.

All user-facing text lives in `src/i18n.jsx`, English and Arabic side by side. Edit copy there, never in the components. Adding a third language means adding one more block with the same keys. Placeholders in square brackets (branch names, contact details, plan name) are for you to fill in.


## The Dirham mark

The Central Bank's 2025 Dirham symbol has no dependable font coverage yet, so typing the character would render as an empty box on many devices. It's drawn as SVG instead, in `src/Dirham.jsx`. Every amount in the app — cards, charts, tooltips — goes through the `<Money>` component, so replacing the drawing with the Central Bank's official asset is a single-file change.

Amounts always render left-to-right with the mark leading, which is how currency is written in Arabic too.

## Menu engineering

The Menu screen is the standard four-quadrant read used across the industry, plotted against your own medians rather than any external benchmark:

| Quadrant | Meaning | What to do |
|---|---|---|
| Stars | Ordered often, earns well | Protect. Never discount. |
| Workhorses | Popular but cheap | Check portion cost; test a small price move. |
| Puzzles | Earns well, rarely ordered | Better menu position or a server mention before cutting. |
| Drags | Neither | Each still costs prep, stock, and menu space. |

**Honest limitation:** the vertical axis is revenue per order, not contribution margin, because item costs aren't in the receipt feed. The screen says so on the page. Feed costs in from the Loyverse item list and this becomes a real profitability read — that's the single highest-value thing to add next.

## Observations

The "what changed" strip on Watch is computed in `api/_data.js`, not written by a model. Same numbers always produce the same reading, nothing is invented, and it costs no tokens. It surfaces the seven-day trend, the strongest day, the dominant item, the peak-to-quiet spread, branch gaps, and weekend lift — and stays silent when a change is too small to mention.

## Motion

Animation is used where it carries meaning, and skipped where it would just decorate:

- The landing hero prints a receipt line by line, then types out the answer — the product's premise as one motion
- Metric figures count up on load; sparklines show 30-day shape inside the card
- Answers stream token by token with a live caret
- Observations stagger in; branch bars grow in sequence
- Skeleton screens hold the layout while data loads, so nothing jumps

All of it respects `prefers-reduced-motion` — the hooks check it and render final state immediately.

## Keyboard

`⌘K` / `Ctrl-K` opens a command palette on desktop: jump between screens, or type a question and send it straight to Ask without switching first. Arrow keys navigate, Enter runs, Esc closes.

## Installable

`public/manifest.webmanifest` makes it installable to an iPad or phone home screen — standalone window, no browser chrome, Arabic and RTL declared. Replace `public/icon.svg` with your own mark.


## Startup and transitions

The startup sequence plays once per browser session, not on every navigation: the mark lands, the ticket perforation stitches across it, then **سفرة** is revealed right-to-left as though written, followed by the tagline.

The wordmark is revealed with a `clip-path` wipe rather than by animating individual letters. That is deliberate and not interchangeable — Arabic is cursive, and splitting `سفرة` into characters breaks the joins, rendering it as four disconnected shapes. The wipe keeps the word intact and still reads as writing.

Screen transitions are direction-aware: moving down the tab list slides one way, moving back slides the other, so the motion tells you where you went. Views (landing → login → app) settle in rather than cutting.

Everything checks `prefers-reduced-motion` and renders final state immediately when it's set.

## An RTL note worth remembering

The password field's reveal icon sat on top of the text in Arabic. The cause is worth knowing, because it recurs: the input was `dir="ltr"` (correct — credentials are Latin, so typing starts at the physical left), but the icon used the logical `end-3`, which resolves against the *wrapper's* RTL direction and lands on the physical left too.

The fix isn't to hardcode `right-3`. It's to make the whole field an LTR island — `dir="ltr"` on the wrapper — so the input and everything positioned against it resolve consistently. Any mixed-direction field needs the same treatment.


## Identity

Purple and white. **Iris** `#5E2CA5` carries the brand; **lilac** `#9B6BE8` marks peaks and second-tier emphasis; **rose** `#C4426E` is reserved strictly for negative movement, so a falling number never reads as decoration. The ground is white with a faint lavender cast rather than pure `#FFF`, which keeps white cards legible as cards.

Change `src/theme.js` and the matching CSS variables in `src/index.css` to re-skin the whole app.

## Languages

Four: **العربية** (default), **English**, **हिन्दी**, **Filipino**. All 176 string keys exist in all four — a test enforces parity, so a missing translation fails rather than silently falling back.

Arabic is the only RTL script and drives full layout mirroring. Hindi loads Noto Sans Devanagari, since the display face has no Devanagari cut. The assistant is told which interface language is active and given register guidance per language — everyday business Hindi rather than Sanskritised formal register, and natural Taglish for Filipino, because forcing deep Tagalog for words people actually say in English ("sales", "branch", "order") reads as stilted.

The picker is a menu, not a toggle. With four languages a toggle would put Filipino three taps away.

## Feedback on answers

Every completed answer carries a quiet **Not helpful** control. It opens a short form — a reason, an optional note — and sends the question, the answer, the user, and the interface language.

Reports go two places:

1. **Platform logs**, always, as a single line prefixed `SUFRA_FEEDBACK` followed by JSON. Searchable in Vercel's log view, and it works with no configuration at all.
2. **A webhook**, if `FEEDBACK_WEBHOOK_URL` is set. The payload carries both a readable `text` field (which Slack and Discord render directly) and the full structured object. A webhook failure is caught and logged — the report is never lost because a delivery endpoint was down.

Serverless functions have no durable storage, which is why there's no admin table. If you want reports queryable, the smallest next step is Vercel KV or a Google Sheet behind a Zapier hook.

## Navigation

The tab rail runs vertically down the **right edge** on phones and tablets, and the sidebar sits on the right on desktop — the same side in every language. Getting that right needed `flex-direction: row-reverse` under RTL, because flexbox `order` follows text direction and would otherwise flip the rail to the left in Arabic.

Also:

- **Swipe** left and right between screens on touch. Direction follows reading order, so it's inverted in Arabic. Gestures starting on a chart, an input, or a mostly-vertical drag are ignored, so scrolling never navigates by accident.
- **Number keys 1–5** jump straight to a screen on desktop; ignored while typing.
- **⌘K / Ctrl-K** opens the command palette.
- The active-tab indicator is a single shape that **slides**, rather than five that fade — the movement itself shows how far you travelled.


## Dark mode

Three settings — Light, Dark, and **System** (the default). System matters: someone whose phone flips to dark at sunset expects the app to follow, and the provider listens for OS changes live rather than only reading the preference once.

Dark is a designed palette, not the light one inverted. Surfaces lift by lightness rather than by shadow, the primary is lightened so it stays legible on a dark ground, and the tinted washes become low-alpha overlays instead of pale solids. Both palettes are tested for WCAG AA contrast — body text, secondary text, button labels, and panel text all clear 4.5:1 in both modes.

One structural note: colours resolve in JavaScript (`src/theme.jsx`), not through CSS variables. Recharts writes colours as SVG presentation attributes, and `fill="var(--iris)"` doesn't resolve there. The CSS variables still exist for anything styled in CSS and are kept in step by hand.

The toggle sits in the landing nav, the sidebar, the mobile header, and Settings.

## What the landing page does now

Rebuilt after a closer read of the reference product:

- A **numbered section rail** (01–04) fixed to the side on wide screens, tracking which section you're in via IntersectionObserver
- A **data-architecture diagram**: three sources converge on one unified layer, three outputs come off it. Prose can describe this; drawing it makes the single trusted middle the thing you actually see, which is the whole claim
- **Live mini-demos inside** each capability card — a real chat exchange, a real KPI strip with a bar chart, a real forecast band — rather than only describing them
- A **"from insight to decision"** section stating the philosophy plainly: the app doesn't decide for you, it makes the decision clearer
- A **contact footer** with phone, email, and social

## Pricing page

Four modules priced separately at `/pricing`, reachable from the nav, the closing CTA, and the footer. Only the discounted module carries a badge — a badge on every card makes the discount meaningless. Prices render with the Dirham mark.

Edit the numbers in `PRICES` and `WAS` at the top of `src/Pricing.jsx`; the copy lives in `src/i18n.jsx` under `pricing.plans`.


## Chat memory

Conversations persist, grouped the way people remember them — Today, Yesterday, Last 7 days, Older — with search across both titles and message bodies. The title is the first question, trimmed. Deleting the open thread clears the view; deleting any other leaves it alone.

On desktop the history sits as a collapsible column beside the chat, and only there — on the dashboard it would cost reading width for nothing. On touch it's a drawer, closed by default, opened from the header.

**Where it's stored:** both places, deliberately.

Writes land in `localStorage` first, so the interface never waits on the network and the chat keeps working with no connection. They are then pushed to `/api/conversations`, which stores them against the account — so threads follow the person from the phone in the kitchen to the laptop in the office.

On sign-in the two are merged: every thread from either side is kept, and where the same thread exists in both, the newer copy wins. If no database is attached, the remote calls fail quietly and the local copy carries on alone. The chat must never break because storage isn't configured yet.

## Advice

The `Advice` screen generates recommendations in code, not from a model, so the same numbers always produce the same advice and every claim is checkable. Each card carries:

- A **confidence level**, and the evidence behind it stated plainly — receipts, days, units
- The **expected effect**
- **The figures it rests on**, with the period
- An **execution plan** in ordered steps
- **What to watch** and **when to measure**
- A **caution** before acting

Confidence is a function of evidence: a claim about an item that sold four units is not the same kind of claim as one about an item that sold six hundred, and the card says so rather than presenting both with equal weight.

## Auth transitions

Signing in and out replace the entire screen, so they get a deliberate hand-off rather than a cut: the outgoing view recedes and fades over 260ms, a thin progress line crosses the top, then the incoming view settles. `prefers-reduced-motion` skips it entirely.


## Voice

The name is the brief: **سفرة** is the laid table — everything set out where you can see it. That metaphor runs through the product rather than sitting on the logo.

- The dashboard is **the table** (السفرة), not "analytics"
- The forecast is **what's coming** (القادم), not "foresight"
- Advice cards are **notes** (الملاحظات), and they read like a note from someone who watched service: *"{name} is doing the heavy lifting"*, *"{name} is your empty chair"*
- Confidence reads as **strong / fair / thin evidence** rather than percentages dressed up as certainty
- Where we stop is stated as **nothing invented, nothing hidden, nothing forced**

A test (`voice`) scans all four languages for phrasing borrowed from other products and fails the build if any of it reappears. It's there because it caught real drift once already.

## Sign out

Lives on the rail, not in Settings — bottom of the sidebar on desktop, foot of the right-hand rail on touch. Signing out is a navigation action, and burying it three panels into Settings made it a hunt.


## Accounts

Registration is at `/register`: business name, username, password. Passwords are hashed with scrypt and a per-account salt — the plaintext is never written anywhere, and a test asserts that.

**This needs storage.** Serverless functions keep nothing between invocations, so accounts have to live somewhere.

Vercel KV is no longer a first-party product — existing stores were moved to Upstash Redis in December 2024. Install a Redis integration from the **Vercel Marketplace**: project → **Storage** → **Browse Marketplace** → **Redis**.

Either provider works, and `api/_store.js` detects which is attached:

| Provider | Variable it sets | How it connects |
|---|---|---|
| Redis Cloud (and most others) | `REDIS_URL` | TCP, via the `redis` package (already a dependency) |
| Upstash | `KV_REST_API_URL` + `KV_REST_API_TOKEN` | HTTP, no package, no open connection |

Both are fine at this scale. The HTTP one suits serverless slightly better under bursty traffic, since there is no connection to pool or exhaust; the TCP one keeps one client per warm instance and reconnects with backoff. Attach one, redeploy, and nothing else changes.

**Not Global Config.** Global Config (formerly Edge Config) looks like a database in the dashboard but is the wrong tool here: it is read-optimised configuration storage, capped at 1 MB, propagates writes over several seconds, and cannot be written from a function at all — writes go through the Vercel REST API with an account-level token. It is built for feature flags and redirects, not user data.

Without those variables the app still runs, but accounts are held in memory and disappear on the next cold start. The server logs a warning and **the register page tells the person before they rely on it** — losing an account silently is worse than not offering one.

`SESSION_SECRET` signs session tokens and encrypts stored POS tokens. Set it once and leave it: changing it signs everyone out and makes already-stored POS tokens unreadable.

## Connecting a till

Each account holds its own Loyverse token, so one deployment can serve several businesses without them seeing each other's figures — the metrics cache is keyed by token for the same reason.

- The token is **encrypted with AES-256-GCM before storage**. A stolen database dump doesn't hand over read access to a business's entire sales history.
- It is **never sent back to the browser.** The account endpoint reports `posConnected: true` and nothing more.
- Tampered ciphertext decrypts to empty rather than throwing, so a bad secret degrades to "not connected" instead of a broken request.

**First run:** a new account lands on an empty table with the connect prompt over it. Declining is a real choice — the dismissal is remembered, the app carries on, and the same form waits in Settings under *Your till*.

**Empty rather than sample.** A registered account with no till of its own sees an empty table, not demo figures. Showing someone else's numbers under their business name is worse than showing nothing. Deployments running on a server-wide `LOYVERSE_ACCESS_TOKEN`, and the shared-password demo, are unaffected.


## Packages and the paywall

Registering creates an identity. It does not grant access. A new account lands on the **Packages** screen with nothing unlocked.

Three packages map to screens:

| Package | Unlocks | Price |
|---|---|---|
| The table | Dashboard and menu quadrants | 200/month |
| The assistant | Ask and Notes | 200/month |
| What's coming | Forecast | 100/month |

Settings and Packages are never gated — someone locked out of everything still needs to reach their account and buy something.

**Gated on the server, not just in the interface.** `/api/metrics` and `/api/chat` check entitlements and return **402** when the package isn't owned. A paywall that only hides buttons isn't a paywall; anyone can call the endpoint directly.

**Expiry is enforced on read**, so a lapsed subscription closes itself without a scheduled job.

**Demo sessions stay open.** A session with no account record behind it — the shared-password route — is deliberately ungated, so single-tenant deployments work exactly as they did before packages existed.

### Making the payment real

`api/billing.js` is a mock. No processor, no card, nothing charged. The screen says so rather than showing a fake card form, because a realistic-looking card field is a good way to have someone type a real card number into it.

There is one marked line in `api/billing.js` where a real payment check belongs:

```js
// const paid = await processor.verify(req.body.paymentIntentId);
// if (!paid) return res.status(402).json({ error: "payment" });
```

Entitlements are granted in exactly one function, so there is exactly one thing to secure.

## Wording

"Till" is British for the cash register and reads oddly in a UAE product, so the interface says **POS** throughout — the same term Loyverse uses and the industry standard here. "Bill" would have been wrong in most of those places ("connect your bill" isn't a sentence), so POS it is.

## Business details

Contact details live in `src/contact.js`, one place, read by the landing footer, the pricing page and Settings. Change them there.


## Screen routing order

`src/Shell.jsx` routes screens in a deliberate order, and the order is the point:

1. **Packages** and **Settings** — never depend on the dashboard figures
2. **Locked** — the package isn't owned
3. **Ask** — handles its own empty state
4. **Empty table** — registered, but no POS connected
5. Loading, error, then the data screens

Settings sits second because it is where someone goes to connect a POS or buy a package — which is usually the fix for whatever made the figures fail. Routing it after the error branch meant a failed metrics call hijacked the one screen that could resolve it, leaving a "Try again" button that could only fail again. A test now asserts the ordering so it can't drift back.

The error screen also offers a route to Settings rather than only a retry, and a 402 (package not owned) is not reported as a loading failure — the locked screen already explains that.


## Free tier

The dashboard is **free with every account**. Connect a POS and you can read your own week without paying — that is what makes the paid pieces worth buying, and a product nobody can use sells nothing.

| | Price | Unlocks |
|---|---|---|
| The table | Free | Sales, orders, branches, busiest hours, top dishes |
| The assistant | 200/month | Ask and Notes |
| Menu study | 150/month | The four-quadrant menu read |
| What's coming | 100/month | Forecast |

`FREE_FEATURES` in `api/_accounts.js` is the single source of truth; `activeItems()` merges it with whatever has been bought, so the free tier survives both a purchase and an expiry.

## Contact details are blank on purpose

`src/contact.js` ships empty. Anything left blank is **hidden**, not shown as a placeholder — an app displaying `+971 00 000 0000` to a customer is worse than one showing no phone number at all. Fill in what you have and delete what you don't; the footer, the pricing CTA and the support panel all follow.

## Fixes worth remembering

**The section rail listened on the wrong target.** `scroll` events don't bubble, so a `window` listener only ever hears the document scrolling. With `html, body, #root { height: 100% }` the scrolling element can be an inner container, so the rail rendered once and never updated. It now listens in the **capture phase on `document`**, which hears scroll from any element.

**A purchase needed a sign-out to take effect.** Buying refreshed the account but not the figures, so a newly unlocked screen still held the `null` it received when the request was refused. `refreshEverything()` reloads both.

**Settings broke on its own.** It was reading `data.connected` while `data` was still `null`, which threw before the screen rendered. It now receives a correctly-shaped blank, and is routed before any branch that depends on figures.

**The packages screen hijacked navigation.** The "nothing bought yet" redirect fired on every account reload — and with a free tier most accounts legitimately own nothing, so it fired constantly. It now shows once, immediately after registration.


## No invented numbers

A real account never receives sample data. Earlier, if the POS couldn't be read for any reason, the app quietly fell back to sample figures with a small label — so someone who had just pasted a working token could be looking at a full dashboard of numbers that weren't theirs. That's worse than an error: it hides the failure, and at a glance it's indistinguishable from the real thing.

`/api/metrics` now answers with one of:

| State | Status | What you see |
|---|---|---|
| Working | 200 | Your own figures |
| No POS connected | 409 | The empty table, with a connect button |
| POS connected but unreadable | 502 | The actual reason |

Loyverse errors are passed through with their meaning attached — *"The access token was rejected: Invalid access token"* rather than *"responded 401"* — so a bad token is one glance to diagnose rather than a hunt.

Sample data survives in exactly one place: the shared-password demo, which has no account and nothing to connect.

## The section rail, third attempt

Two earlier fixes failed for the same underlying reason: both tried to guess **which element scrolls**.

1. `IntersectionObserver` needed the right root, and the `rootMargin`/`threshold` combination meant a section taller than the viewport never fired at all.
2. A `scroll` listener needed the right target — and `scroll` doesn't bubble, so a `window` listener never hears an inner container. With `html, body, #root { height: 100% }` the scrolling element isn't reliably the window.

It now reads `getBoundingClientRect()` once a frame and bails out when nothing has moved. Rects are measured against the viewport, so they change no matter what scrolled — the question of which container is doing the scrolling stops mattering.


## The 402, explained

Loyverse returns **402 PAYMENT_REQUIRED** when an integration asks for receipts older than 31 days without the *Unlimited Sales History* add-on. It is the most common "I made a token but can't pull my data" case, and it looks like an authentication problem when it isn't one.

Sufra asked for 60 days, so it could compare this month against last month. That triggered the 402 on any account without the add-on.

It now asks for 60 days, and **narrows to 30 and retries** if the plan won't allow it. The narrowed case is flagged: with only 31 days there is no earlier period to compare against, so the deltas are `null` rather than computed from a partial window, and the dashboard says why. Turning on Unlimited Sales History in Loyverse brings the comparisons back with no change here.

## Sample data has been deleted

Not gated, not flagged — removed. `sampleMetrics()` is gone from the codebase along with every fabricated branch name and dish. `getMetrics()` takes a POS token or throws.

There is now no code path that can put a number on screen that didn't come from a real POS.

## Build stamp

`src/build.js` holds a version string, shown at the bottom of Settings. "Is the new code actually live?" kept being the first question and the hardest to answer from a screenshot. If the number on screen doesn't match the one in the file, the deploy didn't take — and that's a Vercel problem, not a code one. Bump it whenever you deploy.


## The section rail, finally

Three earlier attempts all failed on the same question — *which element is scrolling?* IntersectionObserver needed the right root; a scroll listener needed the right target, and `scroll` doesn't bubble. With `html, body, #root { height: 100% }` the scrolling element isn't reliably the window.

Two changes fixed it for good:

**It measures instead of listening.** `getBoundingClientRect()` is relative to the viewport, so it changes no matter what scrolled. Read once a frame, skipped entirely when nothing moved.

**It moves continuously.** The old version only had four states, so scrolling produced no visible change until you crossed a threshold — which reads as broken even when the logic is right. There's now a track with a fill and a marker that slide smoothly with scroll position, interpolating between sections rather than snapping.

One more thing that would have broken it regardless: `.view-in` on the landing wrapper animated `transform`. **A transform on an ancestor makes `position: fixed` resolve against that ancestor rather than the viewport**, which drags a fixed element along with the page. That animation is now opacity-only, which looks identical and removes the hazard.


## Fixes in build 16

**Every token minted a new conversation.** `updateMessages` read `activeId` from state, which is still `null` on every call until React re-renders — so during streaming each token created a fresh thread. One question produced a dozen sidebar entries. The id now lives in a ref, which updates synchronously.

**Typing was choppy for the same reason.** Every token wrote to storage, re-read the whole conversation list and pushed to the server. None of it survived the next token. Mid-stream updates now only change the transcript in memory; persistence happens once, when the stream ends.

**The business name is read, not asked for.** Registration takes a username and password. When an account connects its POS, `/merchants` supplies the business name — a name they've already typed into Loyverse once.

**Closing an account does something.** `DELETE /api/account` marks it with a seven-day window; `POST` cancels within that window; the record and its conversations are purged on the first request after the window closes. No scheduled job — expiry is enforced on read, the same way lapsed subscriptions are.

**The menu screen shows what exists.** Quadrants need at least two priced items to mean anything — a median of one number tells you nothing. Below that it now shows the dishes that have sold, ranked, instead of an empty screen.

**Notes always say something.** With too few orders to read patterns from, there's now a note that says exactly that, marked as thin evidence, and explains what will change once a normal trading week is in. An empty screen reads as a broken app rather than a quiet month.

### The section rail

All four tracked ids are present in the page, and a test now asserts that — if one goes missing, the rail can never advance past the last section that exists, which looks exactly like being stuck. It also warns in the console naming any id it can't find, so this is diagnosable in one glance rather than by inference.


## Why the assistant's typing was choppy

Three separate causes, in order of how much they mattered:

**Auto-scroll was fighting itself.** `scrollIntoView({ behavior: "smooth" })` ran on every message change — dozens of times a second during streaming. Each call restarts the animation, so it never completed and the view stuttered instead of scrolling. It now jumps instantly while text is arriving and keeps the smooth behaviour only for moments it can finish.

It also stops following when the reader has scrolled up. Yanking someone back to the bottom while they're reading an earlier answer is worse than not following at all.

**Every message re-rendered on every token.** The row is now a memoised component, so a delta arriving in the last bubble doesn't re-render the transcript above it.

**Deltas painted one-for-one.** They now accumulate and repaint once a frame. This changes nothing when tokens arrive slower than the refresh rate — the point is the ceiling. Anthropic delivers several deltas per network read, and a burst of forty now paints once instead of forty times.


## Build 18

**`pendingDelete is not defined`.** The deletion panel's markup went in but its state block didn't — the edit was anchored to a line an earlier change had already rewritten, so it silently applied to nothing. A test now scans every component for identifiers that appear *only* inside markup braces and nowhere else in the file, which is exactly the shape of that bug.

**Responses arrived a clump of words at a time.** The network doesn't deliver one token at a time: Anthropic sends several deltas per packet and Vercel's proxy batches further, so text lands in bursts. Painting what has arrived reproduces the bursts on screen.

The display is now decoupled from the network. Received text goes into a buffer and a frame loop reveals it at a steady rate, catching up proportionally to the backlog so it never falls behind a fast answer, and draining fully before the message is marked complete. `prefers-reduced-motion` skips the reveal entirely.


## Reveal pacing

The buffered reveal was right in principle and badly tuned in practice. Catch-up scaled with the backlog and had no ceiling:

| Backlog | Old speed | New speed |
|---|---|---|
| 20 chars | 240/sec | 113/sec |
| 120 chars | 1,200/sec | 203/sec |
| 300 chars | 3,000/sec | 365/sec |
| 600+ chars | 6,000/sec | 520/sec (capped) |

Three hundred characters waiting meant three thousand a second — a dump, not typing. And because the rate swung by 10× as packets landed, the *variation* read as choppy even where the average was fine. The new curve varies by 3× at most.

Rates are now per second and measured against the clock rather than per frame, so a 120Hz screen doesn't reveal at double speed.

There's also a 320ms lead-in before the first character. Starting the instant the first packet arrives means the opening line stutters while the buffer is nearly empty; a beat of nothing is steadier. It's skipped if the whole response has already arrived.

**Why not buffer the entire response first?** It was the obvious suggestion and it's a reasonable instinct, but a long answer takes several seconds to generate — that would be several seconds of a blank screen with no sign anything is happening, which reads as broken rather than smooth. The lead-in gets most of the benefit for a third of a second.


## Reveal cadence

The chat reveal now uses **exactly the landing page typewriter's timing**: two characters every eighteen milliseconds, a flat 111 characters per second.

Flatness is the whole point. Every earlier version scaled the rate to how far behind it was, and the *variation* is what read as choppy — even when the average speed was reasonable. A constant rate has nothing to notice.

A test reads the cadence out of `Landing.jsx` and asserts the chat matches it, so the two can't drift apart.

**The trade-off, stated plainly:** a long answer takes about as long to reveal as it takes to read. Two thousand characters is roughly eighteen seconds. `RELIEF_ABOVE` is the single concession — past 1,500 characters of backlog the step doubles, so an unusually long reply doesn't leave someone waiting on text that arrived a while ago. Both constants sit at the top of the streaming block with comments, if you want it faster or slower.


## Build 22

### Sign-in is closed

The old login had a fallback: with no `APP_PASSWORD` set, any unrecognised username was issued a token. On a deployment without that variable — which is most of them — anyone could sign in with anything. That path is gone. There is one route: a stored account whose password hash matches, and nothing else opens the door.

Registration now takes an **email address**, indexed so sign-in accepts either the address or the username. Duplicate addresses are rejected case-insensitively, and deleting an account frees its address again. A failed sign-in returns the same message whether the account doesn't exist or the password is wrong, so the response can't be used to discover which addresses are registered.

`APP_PASSWORD` no longer signs tokens either. It used to be part of the signing secret, which meant setting it silently invalidated every existing session.

### Sessions can be revoked

Tokens now carry a version that's checked against the account on every request. Bumping it ends every session issued before, which is what makes these two mean anything:

- **Changing your password** signs out every other device
- **Sign out everywhere** ends every session but the current one

Both hand back a fresh token for the current device, so changing your password doesn't sign you out of the device you changed it on.

Settings shows last sign-in and when the password was last changed.

### The feed is live

The dashboard polls every 30 seconds while the tab is visible, and stops when it isn't — a screen left open on a back tab shouldn't hit the POS all night. Returning to the tab refreshes immediately.

The server caches for 45 seconds per POS token, so several tablets in one restaurant share a single upstream call rather than multiplying it against Loyverse's rate limit. `?fresh=1` bypasses the cache for the manual refresh button.

The response carries its own age, and the interface shows it — "updated 12s ago", ticking on its own, with the dot pulsing during a fetch and turning red past two and a half minutes. A dashboard claiming to be live should show its own age; otherwise a frozen feed and a quiet evening look identical.

Background polls never replace the screen with an error. A failed poll leaves the last good figures up and lets the age indicator tell the story.


## PureMargin

Renamed from Sufra. The name is now a promise about a number, so the product had to actually produce that number.

### Net profit is real now

Loyverse receipts don't carry cost, which is why the app could only ever show turnover. It now reads the **items endpoint**, takes `cost` off each variant, and joins it to the line items by item and variant name — so a large latte and a small one aren't averaged together.

```
net profit = sales − Σ(unit cost × quantity)
```

Three things follow from doing this honestly:

**Cost coverage is reported.** A 100% margin almost always means costs are missing, not that everything is free. The app tracks what share of turnover has cost data behind it and says so.

**The score refuses to invent confidence.** Below 25% coverage the Pure Score returns `null` and the ring shows a dash, not a flattering number.

**Missing costs are surfaced, not hidden.** Every selling item without a cost is listed on the Menu screen with its selling price and a field to enter what it costs you. Owner-entered costs override the POS — they know what they actually pay, and Loyverse costs are frequently left at zero. Saving recalculates immediately; the cost overrides are part of the cache key, so figures can't go stale behind an entry.

The assistant is given net profit, per-item margin, and the list of items with no cost — with instructions to ask for a specific item's cost rather than guess, one at a time, highest-selling first.

### The overview

- **Pure Score** — a ring blending margin health (65%) with sales trend (35%). A healthy margin on collapsing sales isn't health.
- **Pure margin** — net profit large and plain, with the margin percentage beside it.
- **Star product** — the biggest contributor to *profit*, not revenue. They're often different items, and that difference is the point.
- **Hidden champions** — high margin, below-median volume. Every extra sale keeps more than the average sale does.
- **Leakage radar** — an item whose cost eats most of what it earns, discounting that has stopped being occasional, or costs missing on enough of the menu that the margin can't be trusted. Each finding names the figure behind it and is tappable through to the assistant.

### Photos

Dish photos come from the POS catalogue — the owner's own photographs of their own food, not stock imagery and not an emoji standing in for one. Items without a photo fall back to an initials tile rather than a broken image.

### Greeting

Sits with the identity in the sidebar and in the mobile header, on the device's own clock, re-checked every minute — so a dashboard left on a counter through a shift doesn't still say "good morning" at nine at night.

### On the two reference images

They pull in opposite directions: one calm and white, one dark chrome and neon. For a screen whose job is showing money, this takes the first one's structure — generous cards, 20px radii, soft two-layer shadows — and adds a precision edge: tabular mono figures, a thin luminous inner edge on the score panel, and a dark mode that reads like instrumentation. Neon would fight legibility on exactly the numbers people open this app to read.


## The 2068 look

A full visual rebuild, committed to one idea: **an instrument panel, not an arcade.** Neon-on-black is the obvious reading of "cyberpunk" and the wrong one for a screen whose entire job is showing somebody their money — glow fights legibility exactly where legibility matters most.

**Substrate.** Not black: `#08060E`, a violet-black, so the ground carries the same hue as the light on it. A fixed 44px grid at 5% opacity gives depth without pattern noise, and stays put while panels move over it.

**Panels are lit, not outlined.** Each carries a hairline inner highlight along its top edge and a violet bloom beneath. That single move is what separates an instrument from a dark theme — the surface emits rather than being drawn.

**HUD brackets** on the two primary readings only. Corner brackets are a convention that becomes wallpaper if applied everywhere, so they mark the figures that matter and nothing else. They mirror correctly in Arabic.

**Typography.** Space Grotesk for display, JetBrains Mono for every figure. All numerals are tabular — digits that change width as they update read as unstable, and these update every 30 seconds. Micro-labels are 10px uppercase mono at wide tracking, doing the work a heavier heading would without the weight. Arabic and Hindi keep IBM Plex Sans Arabic and Noto Sans Devanagari; both are geometric enough to hold the register.

**Colour.** Violet stays the identity, pushed to an emissive `#A855F7`. One addition: a cold cyan `#22D3EE`, used strictly for live data and readouts, never for branding. That violet-against-cold pairing is what reads as instrumentation. Both palettes clear WCAG AA on every text pairing — the dark ground actually improves contrast rather than trading it away.

**The Pure Score is now a dial**: forty graduations, a glowing arc that runs cyan to white, and the figure emissive at its centre.

**Dark is the default.** Light mode survives as a cold laboratory variant for bright kitchens, but it's the accommodation, not the intent.

**Restraint.** One sweep animation, on one panel. One emissive figure per screen. Everything respects `prefers-reduced-motion`.


## The mark

`src/NeonMark.jsx` — the PM letters as neon tube, drawn in SVG.

Rebuilt as vector rather than using the supplied PNG for three reasons: the artwork has a circuit-board background baked into the raster and the brief was letters only; vector stays sharp at 34px in the sidebar and 280px on the splash; and the glow can respond to state instead of being fixed in the image.

The tube is three passes over one path — a wide soft bloom, a mid halo, then a bright core. That layering is how a real neon sign reads: the light spills much further than the glass. Filter ids come from `useId`, so several marks on one page don't collide.

The app icon is the same construction on the substrate colour.

## Startup

Rebuilt from the supplied animation file, which decompressed cleanly out of the bundle — so this follows the authored timing rather than an impression of it.

The flicker table is lifted verbatim: a real tube doesn't ramp up, it stutters. Then the light sweep across the frame at ignition, the post-ignite bloom, the breathing hum at 1.5 rad/s, the drift and fade at rest. Driven by one clock rather than a chain of timeouts, so the phases overlap the way they do in the original instead of stepping one after another.

## Scanline removed

The panel sweep is gone — keyframes, class and every use.

## The menu

Every item now appears with its own photograph from the POS catalogue, alongside quantity, revenue and margin where the cost is known. The quadrant chart says how items relate to each other; this says what they actually are.

## Mobile type

A phone is held at arm's length in a busy kitchen, often in poor light, so the ramp is lifted rather than merely reflowed. Body text goes to 16px, small text to 15px, and the primary readings — the figures someone glances at between orders — to 34px. Rail labels are pinned so the tab strip doesn't need to widen.

## On the Figma link

Figma blocks automated access, so I could not open that file. This works from the logo, the animation source and the existing design. If there's something in the Figma this misses, a screenshot is the quickest way to settle it.


## Build 26 — the redesign, and mobile

### Design system adopted from the Figma export

The zip's `index.css` gave the real tokens, so this is the system rather than an impression of it:

- **Void** `#08080F`, surface `#0D0C18`, panel `#11101F`, border `#2D1F5E`
- **Violet** `#A855F7`, magenta `#D946EF`, bright `#C084FC`, glow `#9333EA`
- **Text** `#F0E8FF`, muted `#8B7AAC`
- **Orbitron** display, **Tajawal** Arabic, **JetBrains Mono** figures
- Panel gradient face with `backdrop-filter`, neon borders, notched `angular` corners, HUD labels

Both palettes still clear WCAG AA on every text pairing.

**The scan-line is deliberately not adopted.** It's in the source file; it is excluded here, and a test asserts nothing renders one.

### The Arabic bug

Letters appeared with gaps between them because **letter-spacing was being applied to Arabic**. Arabic is cursive — adding tracking forces the browser to break the joins, so words render as disconnected letters. It came from the mobile media query, which re-set `.micro` tracking after the RTL override had already corrected it.

Two fixes: Tajawal is now the Arabic face in every role including display (Orbitron has no Arabic cut, so it was falling back mid-string), and every tracked class is reset to zero under RTL — including any `tracking-*` utility — with the rule placed so nothing later can reintroduce it. A test now walks every RTL rule in the stylesheet and fails if any letter-spacing is non-zero.

### Mobile

**Why it was overlapping:** the previous scale forced fixed pixel sizes onto elements that were also flex children, so text grew past its container. It now scales the root (`17px`) and lets everything derive from it.

**The header carried seven controls** across a 360px screen — logo, greeting, live dot, chat, status pill, theme toggle, language picker. It now carries the logo, the live dot and two buttons; everything else moved into an overflow sheet, which closes on navigation.

**The rail** holds eight tabs at 468px, which fits a 640px viewport with room to spare, and scrolls if a screen is shorter. Sign-out is pinned so it can't be pushed off.

**Rows can't collide:** every name/figure row truncates the name and fixes the figure's width. Long dish names used to push the number out of the card.

**Grids stack** on a phone instead of squeezing three columns into 360px, and padding tightens because margin is screen space.


## Build 27 — the build break

`src/index.css` had an empty `@media` block followed by an orphaned `}`. PostCSS stopped at it and the Vercel build failed.

It came from an edit that removed the old mobile scale by slicing between two string offsets. The end offset landed inside a rule rather than after it, so the opening half went and the closing brace stayed. Nothing downstream noticed, because **the verification script only ever parsed JavaScript** — 698 tests passed on a stylesheet that couldn't compile.

That gap is closed. `check.mjs` now validates the stylesheet on every run: brace balance, orphaned closers, and empty rules — which are legal CSS but are reliably the fingerprint of a truncated edit. There's also a fuller `css` suite covering unterminated comments, declarations stranded outside a rule, and `@import` position.

The check was verified against a deliberately broken sheet before being trusted: appending a stray `}` makes it report `braces unbalanced (depth -1, orphan closer)`.


## Digits

Arabic reads right-to-left, but the figures stay in Western digits — which is what a UAE till prints, what invoices carry, and what suppliers quote. Arabic-Indic numerals would read as archaic in a finance product here.

There were two sources:

**Hardcoded numerals in the Arabic strings** — 23 of them, in the demo receipt, the password rules, the grace periods. Converted, including the Arabic decimal separator `٫` and thousands mark `٬`.

**Locale formatting.** `toLocaleDateString("ar-AE")` renders Arabic-Indic digits in most browsers, and CLDR has changed its mind about the Arabic default more than once — so leaving it to the runtime means figures that differ between browsers on the same account. Every locale is now pinned through one table in `i18n.jsx`:

```
ar → ar-AE-u-nu-latn
hi → hi-IN-u-nu-latn
en → en-AE
tl → en-PH
```

Two calls had no locale argument at all, which falls back to the *browser's* locale — so an Arabic-configured phone would show Arabic-Indic digits regardless of the app's language setting. Both pinned.

Month and weekday names still come through in the reading language: Arabic shows **السبت، 22 أغسطس**, Hindi **शनिवार, 22 अग॰**. Only the digits changed, which is the part that matters.

A test scans every source file for Arabic-Indic and Devanagari digit ranges, checks no `toLocale*` call is left bare, and asserts the actual runtime output for all four languages.


## Build 29 — a real mobile layout

### Why not a separate app

You suggested one, and I'd push back: two codebases drift, and every fix lands twice. What the problem actually needed was a **separate shell**, not a separate app — `src/MobileShell.jsx` is chrome only. Same screens, same data, same components, passed in as children. One place to fix anything.

### Mobile gets its width back

The side rail cost **60px of a 360px screen** — a sixth of the width, permanently, on the axis phones have least of.

Navigation moved to the bottom, where it costs height instead (phones are tall) and sits under the thumb rather than at the far top corner. Five primary tabs plus "more"; six targets across 360px is 60px each, comfortably above the 44px minimum. Secondary screens, sign-out, language and theme live in a sheet above the bar.

Content is now full width. The top bar carries identity and the live dot and nothing else.

### The design, copied rather than approximated

Ported from the export at its own values, into `src/ui.jsx` so there's one definition instead of a dozen near-copies:

- `NeonButton` — the `#9333EA → #D946EF` gradient with its exact two-layer shadow, and the ghost variant on `rgba(17,16,31,.9)`
- `PcbDecor` — the circuit trace and solder-dot motif
- `GlowDot`, `HudLabel`
- `angular` (16px) and `angular-sm` (10px) notches
- `corner-tl` / `corner-br` brackets at 20px and 2px, mirrored for RTL
- The substrate now carries the 60px grid *and* the 24px PCB dot matrix, as the export layers them

The scan-line remains deliberately excluded, and a test asserts it.

Removing the touch rail left `RAIL_ITEM`, `RAIL_GAP`, `RAIL_PITCH` and `RAIL_PAD` unused; they're gone rather than left as dead code that later reads as meaningful.


## Build 30 — the white screen

`labelFor` was defined inside the touch-rail block. Replacing that block with `MobileShell` deleted the definition, but `MobileShell` still received `labelFor={labelFor}` — a `ReferenceError` on first render, which happens *before* the error boundary mounts. Hence a blank page rather than the boundary's message.

### Why nothing caught it

The syntax was perfectly valid, so the parse check passed. The scope check was regex-based and looked for identifiers appearing *only* inside markup braces — but `labelFor={labelFor}` has the name on both sides of the `=`, so its heuristic never fired.

That checker is now a real one. It uses TypeScript's parser to walk the syntax tree, collecting every declaration — imports, variables, functions, classes, parameters, destructuring patterns, catch clauses — and resolving every identifier reference against it. No heuristics, and it covers `src` and `api` both.

It was verified against the actual failure before being trusted: deleting `labelFor` again makes it report `Shell.jsx:723 labelFor`, naming the exact line.

`check.mjs` now runs it on every invocation, alongside the parse and stylesheet checks. Three classes of build-breaking fault are now caught before packaging: invalid syntax, invalid CSS, and identifiers that don't resolve.
