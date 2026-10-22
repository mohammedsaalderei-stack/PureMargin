# Put PrivacyInfo.xcprivacy into the App target, without opening Xcode.
#
#   ruby scripts/ios/add-privacy-manifest.rb
#
# ── Why this is a script and not an instruction ──────────────────────────
#
# The privacy manifest exists in the repository, but a file on disk is not a
# file in the app: Xcode only bundles what a target's "Copy Bundle Resources"
# phase names. Miss it and the upload is rejected automatically, by a message
# that names the file rather than the reason.
#
# The instruction was four clicks in Xcode, which is four chances to click the
# wrong one and no way to tell afterwards without archiving. The `xcodeproj`
# gem arrives with CocoaPods, which this project already needs, so the whole
# thing is a dozen lines against the same library Xcode itself writes through.
#
# ── Safe to run twice ────────────────────────────────────────────────────
#
# It checks for the reference before adding one. Running it again after a
# `cap sync`, or on a machine where somebody already did it by hand, reports
# that there is nothing to do and changes nothing — which matters, because two
# references to one file is a build warning that turns into a duplicate
# resource error on the day somebody renames something.

require "xcodeproj"

PROJECT = File.expand_path("../../ios/App/App.xcodeproj", __dir__)
TARGET  = "App"
MANIFEST = "PrivacyInfo.xcprivacy"

abort "No project at #{PROJECT} — run `npx cap add ios` first." unless File.exist?(PROJECT)

manifest_path = File.expand_path("../../ios/App/App/#{MANIFEST}", __dir__)
abort "No #{MANIFEST} at #{manifest_path}." unless File.exist?(manifest_path)

project = Xcodeproj::Project.open(PROJECT)
target = project.targets.find { |t| t.name == TARGET }
abort "No target named #{TARGET}." unless target

# Already in the resources phase? Then there is nothing to do, and adding a
# second reference would be worse than adding none.
already = target.resources_build_phase.files.any? do |f|
  f.file_ref && f.file_ref.path.to_s.end_with?(MANIFEST)
end

if already
  puts "  ok   #{MANIFEST} is already in #{TARGET}'s bundle resources"
  exit 0
end

# The group Xcode shows as "App" — the same folder the Info.plist lives in, so
# the manifest sits beside it rather than at the root of the navigator. Found,
# never created: `find_subpath("App/App", true)` read that as a group inside
# the group and made a second "App" to hold one file.
group = project.main_group.groups.find { |g| g.path == "App" }
abort "No App group in #{PROJECT}." unless group

ref = group.files.find { |f| f.path.to_s.end_with?(MANIFEST) }
ref ||= group.new_reference(manifest_path)

target.resources_build_phase.add_file_reference(ref, true)
project.save

puts "  ok   added #{MANIFEST} to #{TARGET} → Copy Bundle Resources"
