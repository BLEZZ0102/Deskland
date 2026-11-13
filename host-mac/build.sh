#!/bin/bash
# Builds "Deskland Preview.app" for macOS with the Swift compiler from the Xcode Command Line Tools.
#   host-mac/build.sh               app that reads the pages from ../prototype (edit a page, then Reload)
#   host-mac/build.sh --standalone  copies prototype/ into the app so it can be moved out of the repository
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(dirname "$here")"
app="$here/build/Deskland Preview.app"
version="$(sed -E 's/.*"version" *: *"([0-9.]+)".*/\1/' "$repo/tools/version.json")"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "invalid version in tools/version.json" >&2; exit 1; }

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
swiftc -O -swift-version 5 -o "$app/Contents/MacOS/Deskland" "$here/main.swift"
cp "$repo/host/DesklandPreview.ico" "$app/Contents/Resources/"
if [[ "${1:-}" == "--standalone" ]]; then cp -R "$repo/prototype" "$app/Contents/Resources/prototype"; fi

cat > "$app/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Deskland Preview</string>
  <key>CFBundleDisplayName</key><string>Deskland Preview</string>
  <key>CFBundleIdentifier</key><string>app.deskland.preview.local</string>
  <key>CFBundleExecutable</key><string>Deskland</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$version</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppleEventsUsageDescription</key><string>Deskland asks Finder where your desktop icons are so the scenery can grow around them. File names and contents are not read.</string>
</dict>
</plist>
EOF
codesign --force --sign - "$app" >/dev/null
echo "built: $app"
