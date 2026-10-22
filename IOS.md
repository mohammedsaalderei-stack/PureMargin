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
npm run ios:open
```

`pod install` is the step Windows could not do: it fetches the native source
for the six Capacitor plugins. Everything else is already in the repository.

### The one manual step in Xcode

**Add the privacy manifest to the target.** The file exists but Xcode does not
yet know to bundle it, and an upload without it is rejected automatically.

1. In the file navigator, right-click the `App` folder → **Add Files to "App"…**
2. Choose `ios/App/App/PrivacyInfo.xcprivacy`
3. Tick **Copy items if needed** off, and make sure **App** is ticked under
   *Add to targets*
4. Select the project → **Build Phases → Copy Bundle Resources** and confirm
   `PrivacyInfo.xcprivacy` is listed

### Signing

Select the **App** target → **Signing & Capabilities** → tick *Automatically
manage signing* and choose your team. The bundle identifier is
`ae.puremargin.app` and **must never change** — it is the app's identity on the
store forever.

---

## Every release after that

```bash
npm run ios          # builds the web app and syncs it into ios/
npm run ios:open     # opens Xcode
```

Then **Product → Archive**, and **Distribute App → App Store Connect**.

Bump the version in Xcode under the General tab before each upload. Apple
refuses a build whose number it has seen before.

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
