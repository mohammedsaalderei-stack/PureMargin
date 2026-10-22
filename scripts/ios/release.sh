#!/usr/bin/env bash
#
# Build, sign and upload PureMargin to App Store Connect, without Xcode's
# windows.
#
#   bash scripts/ios/release.sh            build and export the .ipa
#   bash scripts/ios/release.sh --upload   …and send it to App Store Connect
#
# ── Why bother, when Xcode has a button ──────────────────────────────────
#
# Because the button is not reviewable. A release done through the Organizer
# leaves no record of which options were chosen, cannot be run from a machine
# nobody is sitting at, and has to be rediscovered every time — and the steps
# it hides are the ones that fail: a stale provisioning profile, a build
# number already used, a privacy manifest that was never added to the target.
#
# Everything here is a command, so a failure names itself and the fix is a
# line in a file rather than a memory of which checkbox it was.
#
# ── What it needs ────────────────────────────────────────────────────────
#
#   APPLE_TEAM_ID     ten characters, from developer.apple.com → Membership
#
# and, to upload without anybody signing in:
#
#   ASC_KEY_ID        App Store Connect → Users and Access → Integrations
#   ASC_ISSUER_ID     on the same page, above the key list
#   ASC_KEY_PATH      the .p8 file that page let you download exactly once
#
# Without the three ASC_* values the build and export still work and the
# upload step is skipped with a note. An API key is worth creating: it is the
# difference between a release that needs a person at a keyboard and one that
# does not.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

WORKSPACE="ios/App/App.xcworkspace"
SCHEME="App"
BUILD="$ROOT/ios/build"
ARCHIVE="$BUILD/PureMargin.xcarchive"
EXPORT="$BUILD/export"

say() { printf "\n\033[1m  %s\033[0m\n" "$1"; }
die() { printf "\n  %s\n\n" "$1" >&2; exit 1; }

[ "$(uname)" = "Darwin" ] || die "This has to run on macOS: xcodebuild only exists there."
command -v xcodebuild >/dev/null || die "No xcodebuild. Install Xcode and its Command Line Tools."
[ -n "${APPLE_TEAM_ID:-}" ] || die "Set APPLE_TEAM_ID — ten characters, from developer.apple.com → Membership."

# ── 1. the web app ───────────────────────────────────────────────────────
# Every release starts here, because the native project ships a copy of the
# interface rather than loading the site. Forgetting this step produces an
# app that builds, installs, and shows last week's screens.
say "building the web app and syncing it into ios/"
npm run build
npx cap sync ios

# ── 2. native dependencies ───────────────────────────────────────────────
if [ ! -d "ios/App/Pods" ]; then
  command -v pod >/dev/null || die "No CocoaPods. sudo gem install cocoapods"
  say "pod install"
  ( cd ios/App && pod install )
fi

# ── 3. the privacy manifest ──────────────────────────────────────────────
# Idempotent, and run every time rather than once: `cap sync` and a fresh
# clone both produce a project where this has not happened, and the symptom
# is a rejection at upload rather than a failure here.
#
# The script needs the xcodeproj gem that comes with CocoaPods, but where it
# lands depends on how CocoaPods was installed. `sudo gem install` puts it
# beside the system Ruby. Homebrew keeps it in a directory of its own, run by
# its own Ruby, where a bare `ruby` cannot see it — so borrow what Homebrew's
# `pod` launcher sets, which is GEM_HOME and nothing else.
say "making sure the privacy manifest is in the target"
if ruby -e 'require "xcodeproj"' 2>/dev/null; then
  ruby scripts/ios/add-privacy-manifest.rb
elif command -v brew >/dev/null && [ -d "$(brew --prefix cocoapods)/libexec" ]; then
  GEM_HOME="$(brew --prefix cocoapods)/libexec" \
    "$(brew --prefix ruby)/bin/ruby" scripts/ios/add-privacy-manifest.rb
else
  die "No Ruby here can load the xcodeproj gem. Install CocoaPods: brew install cocoapods"
fi

# ── 4. archive ───────────────────────────────────────────────────────────
# `-allowProvisioningUpdates` is what lets signing happen without a dialog.
say "archiving"
rm -rf "$ARCHIVE"
xcodebuild archive \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$APPLE_TEAM_ID" \
  CODE_SIGN_STYLE=Automatic

[ -d "$ARCHIVE" ] || die "No archive was produced."

# ── 5. export the .ipa ───────────────────────────────────────────────────
# The team id is injected here rather than committed, since it is the one
# value that differs per account.
say "exporting the .ipa"
OPTIONS="$BUILD/ExportOptions.plist"
mkdir -p "$BUILD"
cp scripts/ios/ExportOptions.plist "$OPTIONS"
/usr/libexec/PlistBuddy -c "Add :teamID string $APPLE_TEAM_ID" "$OPTIONS" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Set :teamID $APPLE_TEAM_ID" "$OPTIONS"

rm -rf "$EXPORT"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$OPTIONS" \
  -exportPath "$EXPORT" \
  -allowProvisioningUpdates

IPA="$(find "$EXPORT" -name '*.ipa' -maxdepth 1 | head -1)"
[ -n "$IPA" ] || die "Export finished but produced no .ipa."
printf "\n  built %s (%s)\n" "$IPA" "$(du -h "$IPA" | cut -f1)"

# ── 6. upload ────────────────────────────────────────────────────────────
if [ "${1:-}" != "--upload" ]; then
  printf "\n  Not uploaded. Re-run with --upload when you are ready.\n\n"
  exit 0
fi

if [ -z "${ASC_KEY_ID:-}" ] || [ -z "${ASC_ISSUER_ID:-}" ] || [ -z "${ASC_KEY_PATH:-}" ]; then
  die "To upload, set ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH (the .p8).
  Create them at App Store Connect → Users and Access → Integrations.
  The .p8 can only be downloaded once, so keep it somewhere you back up."
fi
[ -f "$ASC_KEY_PATH" ] || die "No key file at $ASC_KEY_PATH"

# Validate first. The same checks the upload runs, but it reports what is
# wrong without consuming the build number — which cannot be reused, so a
# rejected upload costs a version bump and another full archive.
say "validating with App Store Connect"
xcrun altool --validate-app \
  -f "$IPA" -t ios \
  --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"

say "uploading"
xcrun altool --upload-app \
  -f "$IPA" -t ios \
  --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"

printf "\n  uploaded. It appears in App Store Connect once Apple finishes
  processing it, usually in ten to thirty minutes, and you will be emailed
  if it is rejected before that.\n\n"
