# Put the register's printer bridge into the App target, without opening Xcode.
#
#   ruby scripts/ios/add-printer-plugin.rb
#
# It needs the xcodeproj gem. CocoaPods ships one, so if Ruby can't find it:
#   GEM_HOME="$(brew --prefix cocoapods)/libexec" ruby scripts/ios/add-printer-plugin.rb
#
# Three Swift files live in ios/App/App: PrinterPlugin.swift (raw printing to
# receipt printers, Bonjour discovery, AirPrint), BluetoothPrinters.swift
# (Bluetooth LE and Epson/Star MFi printers) and ViewController.swift
# (registers the plugin with Capacitor; the storyboard names this class). A file on
# disk is not compiled until the target's Sources phase names it, which is
# what this does. Safe to run twice: a file already in the phase is skipped.

require "xcodeproj"

PROJECT = File.expand_path("../../ios/App/App.xcodeproj", __dir__)
FILES = %w[PrinterPlugin.swift BluetoothPrinters.swift ViewController.swift]

project = Xcodeproj::Project.open(PROJECT)
target = project.targets.find { |t| t.name == "App" }
abort "No App target." unless target
group = project.main_group.find_subpath("App", false)
abort "No App group." unless group

added = []
FILES.each do |name|
  path = File.expand_path("../../ios/App/App/#{name}", __dir__)
  abort "Missing #{path}." unless File.exist?(path)
  next if target.source_build_phase.files_references.any? { |r| r.path == name }
  ref = group.files.find { |f| f.path == name } || group.new_reference(name)
  target.source_build_phase.add_file_reference(ref)
  added << name
end

project.save
puts added.empty? ? "Nothing to do — every file is already in the target." : "Added: #{added.join(', ')}"
