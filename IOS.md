# PureMargin on the App Store

The iOS app is built, has run in the simulator and on an iPhone, and the
release script archives it. `ios/` is a real Xcode project with the icons, the
permission strings and the privacy manifest in it.

## Where it stands (30 October 2026)

**One thing stops an upload: the paid Apple Developer Program.** The app is
signed by a free Personal Team (`345DD373X5`, "Mohammed Alderei"). That is
enough to run it on a phone, but such a team cannot hold an "iOS Distribution"
certificate or an App Store profile, so `release.sh` archives and then stops
at export with exactly that error. A paid membership is a different team with
its own Team ID: set `APPLE_TEAM_ID` to it and pick it in Xcode's Signing &
Capabilities, and nothing else changes.

| Step | State |
|---|---|
| Compiles (Debug for the simulator, Release for a device) | Done |
| Runs on the iOS 27 simulator and on an iPhone 17 Pro Max (iOS 26.6) | Done |
| `release.sh`: web build, sync, privacy manifest, archive | Done |
| `release.sh`: export the `.ipa`, validate, upload | **Needs the paid program** |
| App Store Connect record, listing, screenshots, privacy answers | To do, after enrolling |
| Reviewer account with sample data | To do |

**Free provisioning expires after seven days.** A copy installed from a
Personal Team stops opening a week later; run it from Xcode again, or install
through TestFlight once the paid team exists.

---

## What is already done

| | |
|---|---|
| Runs from the bundle, not the website | `capacitor.config.json` has no `server.url`. The app ships its own copy of the interface, which is what Guideline 4.2 is about. |
| API calls reach the API | `src/platform.js` points relative `/api/…` paths at `https://www.puremargin.ae` inside the app (the bare domain redirects to www, and iOS drops the sign-in header on that redirect) and changes nothing on the web. |
| No CORS problem | `CapacitorHttp` is enabled, so requests go through native networking, which is not subject to CORS. The API needed no changes. |
| Stays signed in | `src/session.js` uses `localStorage` in the app — iOS kills a backgrounded app without warning, and `sessionStorage` would sign people out at random. |
| Native camera | `src/native/camera.js` opens a viewfinder for clock-in instead of a file picker. **Not reached in the app today:** staff open clock-in from a shared link, which opens Safari, since the app claims no links. Universal Links would bring it into the app. |
| Permission strings | In `ios/App/App/Info.plist`. Without these iOS kills the app silently the moment it touches the camera. |
| Privacy manifest | `ios/App/App/PrivacyInfo.xcprivacy`. Required since May 2024; a build without one is rejected at upload. |
| Icon and launch image | Rendered from `public/icon.svg` by `npm run icons`, square and opaque as Apple requires. |
| Status bar, keyboard, splash, safe areas | `src/native/shell.js` and the `.is-native` rules in `src/index.css`. Seen in the simulator and on a phone. |
| Launches on iOS 27 | The scene life cycle (`SceneDelegate.swift`, `UIApplicationSceneManifest`); without it iOS refuses to launch an app built with the iOS 27 SDK. |
| No zoom on a text field | `lockedViewport` in `src/native/shell.js`; iOS otherwise zooms into any field under 16 px and never zooms back out. |
| Nothing for sale in the app | The app opens on sign-in, not the website's landing page; the pricing page and "get in touch for more packages" are not shown in it (`isNativePlatform()`). Guideline 3.1.1. |
| No analytics | The website's Vercel page analytics are not loaded in the app, matching the privacy manifest. |
| Account deletion | Settings → Account → Delete account, as Guideline 5.1.1(v) requires. |

---

## What you need

| | |
|---|---|
| A Mac | Any Apple-silicon Mac. Xcode is free from the App Store. |
| Xcode 15+ | Plus the Command Line Tools, which it offers to install. |
| Apple Developer Program | 99 USD a year. Approval takes a day or two — **start this first**, it is the long pole. A free Personal Team cannot upload. |
| CocoaPods | `brew install cocoapods`. macOS's own Ruby (2.6) is too old for current CocoaPods; `release.sh` finds Homebrew's. |
| Node 20+ | The same one this project builds with. |

---

## On the Mac, once

```bash
npm install
cd ios/App && pod install && cd ../..
```

`pod install` is the step Windows could not do: it fetches the native source
for the six Capacitor plugins. Everything else is already in the repository.

### Signing

Either sign in to Xcode once (**Settings → Accounts**, add your Apple ID), or
create an **App Store Connect API key** — *Users and Access → Integrations* —
which needs no interaction at all and is what lets a release run on a machine
nobody is sitting at. The `.p8` file downloads exactly once, so keep it
somewhere you back up.

The bundle identifier is `ae.puremargin.app` and **must never change**: it is
the app's identity on the store forever.

---

## Releasing, without Xcode's windows

```bash
export APPLE_TEAM_ID=XXXXXXXXXX          # developer.apple.com → Membership
bash scripts/ios/release.sh              # build, sign, export the .ipa
```

and when you want it on App Store Connect:

```bash
export ASC_KEY_ID=XXXXXXXX
export ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
export ASC_KEY_PATH=~/keys/AuthKey_XXXXXXXX.p8
bash scripts/ios/release.sh --upload
```

That script does every step in order: builds the web app, syncs it into
`ios/`, runs `pod install` if it has not been run, **adds the privacy
manifest to the target**, archives, exports the `.ipa`, validates it, and
uploads. Validation happens before the upload on purpose — it runs the same
checks and reports what is wrong *without consuming the build number*, which
cannot be reused, so a rejected upload otherwise costs a version bump and
another full archive.

The privacy-manifest step is `scripts/ios/add-privacy-manifest.rb`, which
uses the `xcodeproj` gem that arrives with CocoaPods. It used to be four
clicks in Xcode — four chances to click the wrong one, with no way to tell
until an upload was rejected by a message naming the file rather than the
reason. It is safe to run repeatedly and reports when there is nothing to do.

You can still do all of this by hand in Xcode: **Product → Archive**, then
**Distribute App → App Store Connect**. The script exists because that route
leaves no record of which options were chosen.

Bump the version under the target's General tab before each upload. Apple
refuses a build number it has seen before.

---

## App Store Connect

| Field | Value |
|---|---|
| Bundle ID | `ae.puremargin.app` — must match the project exactly |
| Name | PureMargin |
| Primary category | Business |
| Age rating | 4+ |
| Sign-in required | Yes, and they will test it |
| Privacy policy URL | Required before review. It must match `PrivacyInfo.xcprivacy`. |
| Devices | iPhone and iPad (`TARGETED_DEVICE_FAMILY = "1,2"`), so the listing needs iPad screenshots as well as iPhone ones, and review may test on an iPad. The iPad layout has not been looked at yet. Setting the family to iPhone only removes both. |

### Give the reviewer a real account

Under **App Review Information**, put a working username and password for a
sample business that has the packages switched on, recipes with selling
prices, and some sales. An app that opens onto a sign-in wall with no
credentials is rejected without being looked at, and it is the commonest
reason a first submission comes back.

Then put this in the notes. Each paragraph answers a question a reviewer
otherwise has to guess at:

> PureMargin is back-office software for restaurants: sales and margins,
> recipes and their cost, stock, and a register. The demo account is the owner
> of a sample restaurant.
>
> The Register tab records sales of food and drink served in the restaurant.
> Payment is taken at the counter, in cash or on the restaurant's own card
> terminal; the app only records which. These are goods and services consumed
> outside the app (3.1.3(e)).
>
> Features are sold to businesses by our team under a business agreement, not
> in the app (3.1.3(c), enterprise services). The app shows what an account
> has and offers nothing for sale.
>
> To delete an account: Settings → Account → Delete account.

Do not mention clock-in: it opens in Safari from a link, not in the app.

### What the privacy answers must say

They are cross-checked against `PrivacyInfo.xcprivacy`, and a disagreement
stalls the review. The honest account, which is also what the people being
photographed are owed:

- an email address and username, to sign in and reset a password
- photographs of a workplace taken by staff clocking in and out, visible to the
  owner and deletable by them
- photographs of supplier invoices, read for their line items
- sales and stock figures, which are the product
- sales rung up on the register: what was sold, the amounts, and whether it
  was paid in cash or by card — never a card number, which never reaches the
  app

No tracking, no advertising, no third-party analytics SDK. Do not describe the
clock-in photo as "verification" or "identity" — it is neither, and
`api/_attendance.js` explains at some length why that distinction matters.

---

## Still unverified

Stated plainly rather than left to be discovered:

- **The camera on a phone.** Clock-in, the one path that uses the native
  viewfinder, is not reachable inside the app (see above). The scanners use
  the system picker, whose Take Photo has not been tried on the phone either.
- **iPad.** Never opened on one.
- **Export, validation and upload.** Blocked on the paid program; the archive
  step before them works.
- **A till and the register together on one live account.** Register sales are
  joined to Loyverse's in code and tested with a till-shaped read, not yet seen
  with a real Loyverse account.

---

## Android, while you are here

The same configuration covers it and Google Play has no Mac requirement:

```bash
npm install @capacitor/android
npx cap add android
npx cap open android
```

Permissions go in `AndroidManifest.xml` rather than `Info.plist`; Play asks for
the same privacy policy.
