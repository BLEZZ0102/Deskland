#!/bin/sh
# Build a Debian package without extra tooling. Run from the repository root:
#   sh linux/packaging/build-deb.sh
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
LINUX=$(CDPATH= cd -- "$HERE/.." && pwd)
ROOT=$(CDPATH= cd -- "$LINUX/.." && pwd)
VERSION="0.1.3~linux1"
ARCH="all"
PKG="deskland-preview"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

install -d "$STAGE/DEBIAN"
install -d "$STAGE/usr/lib/deskland/linux/deskland_linux"
install -d "$STAGE/usr/lib/deskland/prototype"
install -d "$STAGE/usr/bin"
install -d "$STAGE/usr/share/applications"
install -d "$STAGE/usr/share/icons/hicolor/scalable/apps"
install -d "$STAGE/usr/share/doc/$PKG"

cp -a "$LINUX/deskland_linux/." "$STAGE/usr/lib/deskland/linux/deskland_linux/"
cp -a "$ROOT/prototype/." "$STAGE/usr/lib/deskland/prototype/"
install -m 644 "$HERE/deskland.desktop" "$STAGE/usr/share/applications/deskland.desktop"
install -m 644 "$HERE/deskland.svg" "$STAGE/usr/share/icons/hicolor/scalable/apps/deskland.svg"
install -m 644 "$ROOT/LICENSE" "$STAGE/usr/share/doc/$PKG/copyright"

cat > "$STAGE/usr/bin/deskland-linux" <<'EOF'
#!/bin/sh
export PYTHONPATH="/usr/lib/deskland/linux${PYTHONPATH:+:$PYTHONPATH}"
export DESKLAND_PROTOTYPE="${DESKLAND_PROTOTYPE:-/usr/lib/deskland/prototype}"
exec python3 -m deskland_linux "$@"
EOF
chmod 755 "$STAGE/usr/bin/deskland-linux"

cat > "$STAGE/DEBIAN/control" <<EOF
Package: $PKG
Version: $VERSION
Section: utils
Priority: optional
Architecture: $ARCH
Maintainer: Deskland Linux port contributors
Depends: python3 (>= 3.10), python3-gi, python3-gi-cairo, gir1.2-gtk-3.0, gir1.2-webkit2-4.0 | gir1.2-webkit2-4.1, gir1.2-ayatanaappindicator3-0.1 | gir1.2-appindicator3-0.1, libayatana-appindicator3-1 | libappindicator3-1, xdg-utils
Recommends: gir1.2-gtklayershell-0.1, xdotool
Description: Adaptive wallpaper that follows desktop icons
 Deskland Preview renders a WebGL scene behind the desktop and reshapes it
 around the real positions of desktop icons. Includes the Beach and Meadow
 themes, tray controls, session autostart and privacy-preserving sharing.
EOF

install -d "$ROOT/dist"
dpkg-deb --build --root-owner-group "$STAGE" "$ROOT/dist/${PKG}_${VERSION}_${ARCH}.deb"
echo "built: $ROOT/dist/${PKG}_${VERSION}_${ARCH}.deb"
