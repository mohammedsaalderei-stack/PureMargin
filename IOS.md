# Putting PureMargin on the App Store

`capacitor.config.json` in this folder is the file that makes this possible. It
wraps the site in a native iOS app that Xcode can build and upload.

One thing to be straight about first: **a single file cannot do this on its
own.** Apple will only accept a build produced by Xcode, Xcode only runs on
macOS, and uploading requires a paid Apple Developer Program membership (99
USD a year). What the config file does is remove every decision from the
process, so the rest is running commands. There is no way around the Mac.

---

## What you need

| | |
|---|---|
| A Mac | Any Apple-silicon Mac. Xcode is free from the App Store. |
| Xcode 15 or newer | Plus the Command Line Tools, which it offers to install. |
| Apple Developer Program | 99 USD a year, at developer.apple.com. Signing up takes a day or two to be approved — start this first. |
| CocoaPods | `sudo gem install cocoapods` |
| Node 20+ | The same one this project already builds with. |

---

## Once, to create the iOS project

From this folder, on the Mac:

```bash
npm install
npm install @capacitor/core @capacitor/ios
npm install -D @capacitor/cli
npx cap add ios
```

`npx cap add ios` reads `capacitor.config.json` and writes an `ios/` folder
containing a complete Xcode project. Commit that folder — it holds your icons,
your signing settings and your version numbers, and regenerating it later
throws all of that away.

## Every time you want to ship a new version

```bash
npm run build
npx cap sync ios
npx cap open ios
```

Then in Xcode: **Product → Archive**, and **Distribute App → App Store
Connect**.

---

## Three things that must be right, or the app is rejected

### 1. The camera permission string

This is the one that will bite. Clocking in requires a photograph, and **iOS
kills an app instantly, with no error, if it opens the camera without a
permission string in `Info.plist`.** It is not a warning — the app disappears.

Open `ios/App/App/Info.plist` in Xcode and add:

```xml
<key>NSCameraUsageDescription</key>
<string>PureMargin uses the camera so staff can photograph the workplace when they clock in and out.</string>
<key>NSPhotoLibraryAddUsageDescription</key>
<string>PureMargin saves attendance photographs you choose to keep.</string>
```

Write it as a sentence a person would understand. Apple reads these, and
"needs camera access" is rejected as unhelpful.

### 2. A privacy policy, and being honest in it

Guideline 5.1.1 requires a privacy policy URL in App Store Connect before the
app can be reviewed. PureMargin's says what the attendance feature actually
does, and this matters more than usual because it is unusual:

- a photograph of the workplace is taken and stored
- the employee's name, the branch, and the time are recorded
- the business owner can see all of it, and can delete the photographs

That is the whole of it, and saying so plainly is both what Apple asks for and
what the people being photographed are owed. Do not describe the photo as
"verification" or "identity" — it is neither, and `api/_attendance.js` explains
why at some length.

### 3. Guideline 4.2 — "minimum functionality"

Apple rejects apps that are only a website in a frame. This is the real risk
with this submission, so it is worth planning for rather than discovering.

What helps, and is already true here: the app uses the camera, it is a working
tool rather than a brochure, and it does something a bookmark cannot.

What helps more, if the first attempt is rejected: switch from loading the live
site to bundling it — see below — and add push notifications for arrivals. A
reviewer who sees a native camera sheet and a native notification is looking at
an app.

---

## Hosted, or bundled

The config as written sets `server.url` to `https://puremargin.ae`, so the app
loads the live site. That is the right way to start:

- every fix you deploy reaches the app the same hour, with no review
- there is nothing to keep in step
- it is the fastest route to a first submission

Its two costs are real. The app does nothing without a connection, and it is
the shape of app Guideline 4.2 is aimed at.

**To bundle instead**, delete the whole `server` block from
`capacitor.config.json`. The app then runs the files in `dist/` from inside the
bundle. One thing has to change with it: the app's own pages are served from
`capacitor://localhost`, so every `fetch("/api/…")` in `src/` would look for an
API on the device and find nothing. Those calls need an absolute origin —
`https://puremargin.ae/api/…` — before a bundled build will work at all. It is
a mechanical change across roughly thirty call sites and it is not done yet.

Start hosted. Bundle if the review asks for more.

---

## Details App Store Connect will ask for

| Field | Value |
|---|---|
| Bundle ID | `ae.puremargin.app` — must match `appId` in the config, exactly, forever |
| Name | PureMargin |
| Primary category | Business |
| Age rating | 4+ |
| Sign-in required? | Yes — and they will test it |

**Give the reviewer a real account.** Under "App Review Information", put a
working username and password with a business that has staff on the roster and
some attendance already recorded. An app that opens onto a sign-in wall with no
credentials is rejected without being looked at, and it is the single most
common reason a first submission comes back.

Tell them, in the notes field, that the clock-in page needs no account at all:

> Attendance is used by restaurant staff who have no account. Tap "Clock in" on
> the home screen, search for the demo restaurant by name, choose a branch and
> a person, and take any photograph. No sign-in is involved on that path.

A reviewer who does not know that will try to sign in as an employee, fail, and
mark the feature broken.

---

## Android, while you are here

The same config covers it, and Google Play has no Mac requirement:

```bash
npm install @capacitor/android
npx cap add android
npx cap open android
```

The camera permission is declared in `AndroidManifest.xml` rather than
`Info.plist`, and Play asks for the same privacy policy.
