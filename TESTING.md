# Testing PureMargin after a deploy

Every check below is something a person does in a browser, in order, and can
answer yes or no to. Nothing here needs a terminal.

Work through it once on a desktop and once on a phone. Do the Arabic column at
least for the screens marked **RTL**, because layout faults show up there and
nowhere else.

Expected time: about 40 minutes for the full pass, 10 for the smoke test.

---

## Before you start

Have ready:

- The owner account, and one non-owner account — a cashier is the most
  revealing, because it has the fewest permissions.
- `sample-supplier-invoice.png`, shipped alongside this file.
- A printed customer bill from your own till, or a photo of one.
- A phone, actually held in one hand. Emulated mobile in a desktop browser
  will not tell you whether a drawer is reachable by thumb.

Confirm in Vercel that these are set, then redeploy: `ADMIN_EMAIL`, `APP_URL`,
`MAIL_FROM`, `RESEND_API_KEY`, `SESSION_SECRET`, `REDIS_URL`,
`ANTHROPIC_API_KEY`, and a POS token.

---

## 1. Smoke test — ten minutes

If any of these fail, stop and roll back. Nothing below them is worth testing.

| # | Do this | Expect |
|---|---|---|
| 1.1 | Open the site signed out | The landing page renders, no error screen |
| 1.2 | Sign in as the owner | The dashboard, with real figures from your till |
| 1.3 | Read the top of Overview | **Net margin is the largest number on the page**, above sales |
| 1.4 | Click every tab in the nav | Each one loads. No "This screen didn't load" |
| 1.5 | Switch to Arabic | Whole interface flips right-to-left, no English left behind |
| 1.6 | Open on a phone | Hamburger top-right (top-**left** in Arabic), no bottom bar |
| 1.7 | Tap it | Drawer slides in from the same edge, listing every tab |

**1.4 is the one that matters most.** The last deploy broke on a screen that
rendered everywhere except production, and the failure looked exactly like
"This screen didn't load" with a short message in a box. If you see that box,
copy the message before doing anything else.

---

## 2. The scanners

### 2.1 Cost calculation (a customer bill)

1. Open **Cost calculation**. Before scanning, note the "scans left this
   month" line. It should say 100 on a fresh month.
2. Photograph a real bill from your till.
3. Each line should show a menu match, a quantity, an amount, a cost and a
   profit.
4. **Change a quantity.** The cost and profit on that row, and the totals,
   should update as you type — no re-scan.
5. **Change a menu match** on one line. Same: it re-prices immediately.
6. Scan the same bill again. **The numbers must be identical to the first
   scan.** If they differ, the temperature-zero fix has not deployed.
7. Check the scans-left count went down by one each time.

A line matched to a dish with no cost recorded should show a blank cost, not
zero, and the bill's total cost should be blank rather than a smaller number.

### 2.2 Delivery note (a supplier invoice)

1. Open **Inventory**, scroll to **Delivery note**.
2. Scan `sample-supplier-invoice.png`.
3. Expect roughly this:

| Line on the invoice | Should match | Note |
|---|---|---|
| TOMATOES RED GRADE A | your tomatoes ingredient | 12 kg, 6.50/kg |
| CHICKEN BREAST SKINLESS FRESH | your chicken breast | 8 kg, 22.00/kg |
| OLIVE OIL EXTRA VIRGIN 5L TIN | your olive oil | unit is **tin**, not litres |
| ONIONS WHITE 10KG SACK | your onions | unit is **sack** |
| BASMATI RICE 20KG | your rice | unit is **bag** |
| YOGHURT PLAIN 2KG TUB | your yoghurt | unit is **tub** |
| PAPER NAPKINS 200S | **nothing** | not an ingredient — this is correct |

4. Matching depends on what you actually keep. If your ingredient is called
   "Fresh tomato" it will still match; if you have no tomato at all, that line
   is correctly unmatched.
5. **Every line where the invoice unit differs from your stock unit should
   show a red warning.** Tin, sack, bag and tub all should. That warning is
   the feature working, not a fault — convert before receiving.
6. Fix the unmatched line with the dropdown, or delete it.
7. Press receive. Go to the stock ledger and confirm the movements are there
   with the right quantities and unit costs.

### 2.3 The scan allowance

Only worth testing if you can afford the scans.

1. Note the count. Scan once. It drops by one.
2. Turn off wi-fi mid-scan, or otherwise force a failure. **The count should
   not drop** — a scan you didn't get isn't charged.
3. To see the refusal without spending 100, temporarily lower
   `SCAN_LIMIT_PER_MONTH` in `api/_accounts.js`, deploy to a preview, and scan
   past it. Expect a message about the allowance resetting on the 1st, *not*
   "the photo couldn't be read".

---

## 3. Inventory from a bill

1. As the **owner**, scan a customer bill for dishes that have recipes.
2. Below the priced lines, a **"Take this out of stock"** panel should appear,
   listing ingredients in the units they will be written in.
3. A dish with no recipe should be **named** in a note underneath, not
   silently missing.
4. Adjust one quantity, untick one line, press the button.
5. Check the stock ledger: only the ticked lines, at the adjusted quantities.
6. Sign in as a **cashier** and scan the same bill. **The panel must not
   appear at all** — prices yes, button no.

---

## 4. Permissions

Sign in as each role and check the nav against this. The point is what is
**absent**.

| | Owner | Ops | Branch mgr | Chef | Cashier | Accountant |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Overview, Cost calculation | ✓ | ✓ | ✓ | | ✓ | |
| Ask, Messages, Settings | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Inventory, Alerts | ✓ | ✓ | ✓ | ✓ | | ✓ |
| Plan | ✓ | ✓ | ✓ | | | ✓ |
| Recipes | ✓ | ✓ | | ✓ | | |
| Leakage | ✓ | ✓ | | | | ✓ |
| The table, Menu, Notes | ✓ | ✓ | ✓ | | | |
| Forecasting future sales | ✓ | ✓ | | | | |
| Team, Packages | ✓ | | | | | |

**Then test the URL, not just the nav.** As a cashier, type
`puremargin.ae/#/app/watch` directly. It must land on the dashboard, not on
the table. A nav that hides a tab while the address still opens it is not a
permission.

### 4.1 Extra access

1. As owner, Team → **Extra access**. Give Leakage to the chef role. Save.
2. Sign in as a chef. Leakage is in the nav **and loads with data** — not an
   empty screen or an error.
3. Give one specific person The table. Only they get it.
4. Confirm Team and Packages are not offered as grantable at all.

---

## 5. Adding someone to the team

This is the flow that was broken, so test all three paths.

1. **Somebody who already has an account.** Invite by their email. They should
   join immediately — message says so, and they appear in the member list at
   once.
2. **Somebody with no account.** Invite by email. Check the email actually
   arrives. Have them register with that address; they should land inside your
   organisation, not a fresh empty one.
3. **A mail failure.** If the email does not arrive, the screen should say
   *invited, but the email didn't go out* and show you a link to send them by
   hand. It must **not** say "Couldn't load the team" — if it does, the fix
   hasn't deployed.

Check the invitation link points at `puremargin.ae`, not a `*.vercel.app`
address. If it does not, `APP_URL` is unset.

---

## 6. Messages **RTL**

1. Post to the board as owner. Everyone sees it.
2. Mark one important, addressed to one branch. Only people at that branch —
   and the owner — get the email.
3. Send a **direct** message to one person. Sign in as somebody else and
   confirm it is not on their board. Not visible, not in the page source.
4. As a **cashier**, open the recipient list. They should see colleagues at
   their own branch, plus the owner and the accountant, and **not** a chef at
   another branch.
5. Confirm a direct message emails its recipient even without the important
   flag.

---

## 7. Language and layout **RTL**

For each of Arabic, Hindi and Tagalog:

1. Every visible string is translated. Watch particularly for **Cost
   calculation**, **Forecasting future sales**, the role names in Team, and
   the subtitle under the Overview heading.
2. In Arabic, on the **Ask** screen, check the receipts card: the label and the
   number under it must sit on the same side. That specific card was misaligned
   before.
3. On a phone in Arabic, the drawer opens from the **left**.
4. No box of Latin text stranded mid-sentence in an Arabic paragraph.

---

## 8. Data and history

1. Settings → confirm the POS is connected.
2. If you pay for Loyverse's Unlimited Sales History, **The table** should now
   offer more than 30 days of comparison. If your plan is capped, the screen
   should say so rather than implying a comparison it cannot make.
3. On **The table**, switch Today / This week / This month. Every figure on
   the screen should change, and the heading should name the period.
4. **Overview should have no category filter.** If you see All / Food / Drinks
   / Desserts buttons, this deploy is stale — those did nothing and were
   removed.

---

## 9. Account

1. Change your username in Settings. You stay signed in; other devices are
   signed out; your data, team and history follow the new name.
2. Sign in with the **new** name. The old one should not work.
3. Register a new account **without** an email. It should succeed, and the form
   should say what you give up.
4. Get a password wrong eight times. The ninth attempt should say how long to
   wait, not "check the password".

---

## When something fails

Copy the exact message from the box, note which screen and which language, and
whether you were on a phone. "The Plan tab is broken" takes an afternoon to
find; "Plan tab, Arabic, iPhone, says *Cannot access 'x' before
initialization*" is usually a ten-minute fix.

Check the Vercel function logs at the same moment. Anything the server refused
is logged there with a reason.
