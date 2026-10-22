# PureMargin on the App Store

The iOS app is built and committed. `ios/` is a real Xcode project with the
icons, the permission strings and the privacy manifest already in it. What is
left is the part that can only happen on a Mac.

**Be clear about the wall.** Apple accepts only an `.ipa` — a signed app
package — and only Xcode produces one, and Xcode only runs on macOS. No amount
of configuration moves that. Everything up to it is done.

---

## What is already done

| | |
|---|---|
| Runs from the bundle, not the website | `capacitor.config.json` has no `server.url`. The app ships its own copy of the interface, which is what Guideline 4.2 is about. |
| API calls reach the API | `src/platform.js` points relative `/api/…` paths at `https://puremargin.ae` inside the app and changes nothing on the web. |
| No CORS problem | `CapacitorHttp` is enabled, so requests go through native networking, which is not subject to CORS. The API needed no changes. |
| Stays signed in | `src/session.js` uses `localStorage` in the app — iOS kills a backgrounded app without warning, and `sessionStorage` would sign people out at random. |
| Native camera | `src/native/camera.js` opens a viewfinder for clock-in instead of a file picker. |
| Permission strings | In `ios/App/App/Info.plist`. Without these iOS kills the app silently the moment it touches the camera. |
| Privacy manifest | `ios/App/App/PrivacyInfo.xcprivacy`. Required since May 2024; a build without one is rejected at upload. |
| Icon and launch image | Rendered from `public/icon.svg` by `npm run icons`, square and opaque as Apple requires. |
| Status bar, keyboard, splash, safe areas | `src/native/shell.js` and the `.is-native` rules in `src/index.css`. |

---

## What you need

| | |
|---|---|
| A Mac | Any Apple-silicon Mac. Xcode is free from the App Store. |
| Xcode 15+ | Plus the Command Line Tools, which it offers to install. |
| Apple Developer Program | 99 USD a year. Approval takes a day or two — **start this first**, it is the long pole. |
| CocoaPods | `sudo gem install cocoapods` |
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

### Give the reviewer a real account

Under **App Review Information**, put a working username and password for a
business that has staff on the roster and some attendance already recorded. An
app that opens onto a sign-in wall with no credentials is rejected without
being looked at, and it is the commonest reason a first submission comes back.

Then put this in the notes, because a reviewer who does not know it will try to
sign in as an employee, fail, and mark the feature broken:

> Attendance is used by restaurant staff who have no account. Tap "Clock in" on
> the home screen, search for the demo restaurant by name, choose a branch and a
> person, and take any photograph. No sign-in is involved on that path.

### What the privacy answers must say

They are cross-checked against `PrivacyInfo.xcprivacy`, and a disagreement
stalls the review. The honest account, which is also what the people being
photographed are owed:

- an email address and username, to sign in and reset a password
- photographs of a workplace taken by staff clocking in and out, visible to the
  owner and deletable by them
- photographs of supplier invoices, read for their line items
- sales and stock figures, which are the product

No tracking, no advertising, no third-party analytics SDK. Do not describe the
clock-in photo as "verification" or "identity" — it is neither, and
`api/_attendance.js` explains at some length why that distinction matters.

---

## Things I could not check from Windows

Stated plainly rather than left to be discovered:

- **Nothing here has been run on a device or in the simulator.** The project
  builds as a project; it has never been compiled.
- **The safe-area rules are unverified.** `.is-native` padding in
  `src/index.css` is reasoned from the layout, not seen. Check the bottom of
  the Overview and the clock-in screen against the home indicator first.
- **`pod install` has never run**, so the plugin versions have not actually
  been resolved against each other.
- **The camera path is untested on real hardware.** `fileFromBase64` has unit
  tests over the bytes, but the plugin handing those bytes over has not run.
- **`scripts/ios/release.sh` has never been executed.** Its shell parses and
  every command in it is standard, but no step of it has run; the Ruby script
  has not even been syntax-checked, because there is no Ruby on this machine.

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
