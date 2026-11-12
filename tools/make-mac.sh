#!/bin/sh
# Builds the Mac host for Deskland (macos/) without installing or opening it.
# Writes .capture/dist/Deskland Preview.app (or "<dir>/Deskland Preview.app"): a universal binary (Apple silicon
# and Intel, macOS 13 or later), Info.plist, the bundle's copy of prototype/ and the license
# notices, signed ad hoc. Prints the app's path.
# Copyright (C) 2026 Jeremy Day. GPL-3.0-or-later, see LICENSE.
set -eu
cd "$(dirname "$0")/.."
dist=${1:-.capture/dist}
app="$dist/Deskland Preview.app"

if ! command -v swiftc >/dev/null; then
	echo "swiftc is missing. Install the Xcode command line tools: xcode-select --install" >&2
	exit 1
fi

build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT
for arch in arm64 x86_64; do
	swiftc -O -target "$arch-apple-macos13.0" -module-name Deskland -o "$build/Deskland-$arch" macos/*.swift \
		-framework Cocoa -framework WebKit -framework ApplicationServices >&2
done
lipo -create -output "$build/Deskland" "$build/Deskland-arm64" "$build/Deskland-x86_64"

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$build/Deskland" "$app/Contents/MacOS/Deskland"
cp macos/Info.plist "$app/Contents/Info.plist"
count=$(git rev-list --count HEAD 2>/dev/null || echo 1)
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $count" "$app/Contents/Info.plist"
# The same version as the Windows build (tools/version.json).
version=$(sed -n 's/.*"version" *: *"\([^"]*\)".*/\1/p' tools/version.json)
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${version:-0.0.0}" "$app/Contents/Info.plist"
# The theme pages, unchanged. Not the development server.
cp -R prototype "$app/Contents/Resources/prototype"
rm -f "$app/Contents/Resources/prototype/serve.mjs"
cp LICENSE NOTICE THIRD_PARTY_NOTICES.md TRADEMARKS.md "$app/Contents/Resources/"
find "$app" -name .DS_Store -delete
codesign --force --deep --sign - "$app" >&2
echo "$app"
