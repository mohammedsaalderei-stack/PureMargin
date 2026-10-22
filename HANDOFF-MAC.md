# Brief for the session on the Mac

Paste this as the first message to a Claude Code session started in a fresh
clone of this repository on the Mac. It is written to be read cold.

---

## What you are picking up

PureMargin is a Vite + React app with Vercel-style serverless functions in
`api/`. It has just been turned into an iOS app with Capacitor. All of the
work that could be done on Windows is committed and pushed; what is left needs
macOS, which is why you exist.

Read `IOS.md` first — it is the runbook, and it is current. `AGENTS.md`
describes the application itself.

## State

- `ios/` is a real Xcode project, committed, with icons, `Info.plist`
  permission strings and `PrivacyInfo.xcprivacy` in it.
- The app is **bundled**, not hosted: `capacitor.config.json` has no
  `server.url`, so it ships its own copy of the interface. That is deliberate
  — Guideline 4.2 rejects apps that are a website in a frame.
- `src/platform.js` rewrites relative `/api/…` to `https://www.puremargin.ae`
  inside the app and does nothing on the web.
- `CapacitorHttp` is enabled, so requests use native networking and CORS never
  applies. The API needed no changes. **Do not add CORS headers** on the
  assumption they are missing.
- `scripts/ios/release.sh` does the whole release chain.

## Your job, in order

```bash
npm install
cd ios/App && pod install && cd ../..
export APPLE_TEAM_ID=...            # developer.apple.com → Membership
bash scripts/ios/release.sh         # no --upload on the first run
```

Then open the simulator and check the two things that were reasoned about but
never seen:

1. **Safe areas.** `.is-native` rules in `src/index.css` pad the bottom for
   the home indicator. Check the bottom of Overview and of the clock-in screen.
2. **The camera.** `src/native/camera.js` opens a native viewfinder for
   clock-in. `fileFromBase64` has byte-level unit tests; the plugin handing it
   those bytes has never run.

Only then `bash scripts/ios/release.sh --upload`, which needs `ASC_KEY_ID`,
`ASC_ISSUER_ID` and `ASC_KEY_PATH` from an App Store Connect API key.

## Known-unverified, stated so you do not trust them

Nothing in the iOS work has ever been compiled. `release.sh` parses and every
command in it is standard, but no step has run. `add-privacy-manifest.rb` has
not even been syntax-checked — there was no Ruby on the Windows machine.
**Expect to fix something on the first run.** That is the point of running it
without `--upload` first.

## House rules that are not optional here

- `npm test` runs 56 test files and six checks. Keep them green.
- Mutation-test any new assertion: break the code deliberately and confirm the
  test fails. Several real bugs in this repo were found that way, and several
  tests were found to be passing for the wrong reason.
- Never commit `.env`. Never print a connection string or a password.
- `backups/` is gitignored — a dump holds every account and every ledger.

## Still open, and not yours unless asked

The assistant's grounding (`api/_grounding.js`) gates its sections by
capability but not by purchased package, so a business can potentially get a
feature it has not paid for by asking the chat instead of opening the tab.
That work is happening on the Windows session.
