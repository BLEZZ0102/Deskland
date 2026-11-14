"""Static wallpaper fallback for desktops without a usable background layer.

Used when wlr-layer-shell is unavailable (GNOME Shell/KWin Wayland) or when
``--static`` is passed. The host renders a frame offscreen, writes a PNG and
asks the desktop environment to use it as the wallpaper. Real-time motion is
lost; icon changes still trigger a new frame (throttled).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path


def _run(cmd: list[str], timeout: float = 5) -> bool:
    try:
        return subprocess.run(
            cmd,
            capture_output=True,
            timeout=timeout,
            check=False,
        ).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def _out(cmd: list[str], timeout: float = 3) -> str:
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        return proc.stdout if proc.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


class StaticWallpaper:
    def __init__(self, log) -> None:
        self.log = log
        self.backend = self._detect()
        self._originals: dict[str, str] = {}
        self._xfce_created: list[str] = []
        self._kde_original: str | None = None
        self._captured = False

    def _detect(self) -> str:
        env = (
            os.environ.get("XDG_CURRENT_DESKTOP", "")
            + " "
            + os.environ.get("DESKTOP_SESSION", "")
        ).lower()
        schemas = _out(["gsettings", "list-schemas"])
        # Trust the running desktop before probing schemas: gsettings-desktop-
        # schemas is commonly installed on KDE, which otherwise makes KDE
        # look like GNOME and the GNOME key is written instead of Plasma's.
        if "kde" in env or "plasma" in env:
            if shutil.which("qdbus6") or shutil.which("qdbus"):
                return "kde"
        if "gnome" in env and "org.gnome.desktop.background" in schemas:
            return "gnome"
        if "cinnamon" in env and "org.cinnamon.desktop.background" in schemas:
            return "cinnamon"
        if "mate" in env and "org.mate.background" in schemas:
            return "mate"
        if "xfce" in env and shutil.which("xfconf-query"):
            return "xfce"
        for name, backend in (
            ("org.gnome.desktop.background", "gnome"),
            ("org.cinnamon.desktop.background", "cinnamon"),
            ("org.mate.background", "mate"),
        ):
            if name in schemas:
                return backend
        if shutil.which("qdbus6") or shutil.which("qdbus"):
            return "kde"
        if shutil.which("xfconf-query"):
            return "xfce"
        if shutil.which("feh"):
            return "feh"
        return "none"

    # ---------------------------------------------------------------- capture
    def capture(self) -> None:
        if self._captured:
            return
        self._captured = True
        if self.backend in ("gnome", "cinnamon"):
            schema = (
                "org.gnome.desktop.background"
                if self.backend == "gnome"
                else "org.cinnamon.desktop.background"
            )
            self._originals["schema"] = schema
            for key in ("picture-uri", "picture-uri-dark", "picture-options"):
                value = _out(["gsettings", "get", schema, key]).strip()
                if value:
                    self._originals[key] = value
        elif self.backend == "mate":
            value = _out(["gsettings", "get", "org.mate.background", "picture-filename"]).strip()
            if value:
                self._originals["picture-filename"] = value
        elif self.backend == "xfce":
            for prop in self._xfce_props():
                value = _out(["xfconf-query", "-c", "xfce4-desktop", "-p", prop]).strip()
                if value:
                    self._originals[prop] = value
        elif self.backend == "kde":
            config = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / (
                "plasma-org.kde.plasma.desktop-appletsrc"
            )
            try:
                for line in config.read_text(encoding="utf-8", errors="replace").splitlines():
                    if line.startswith("Image="):
                        # Several containments can store Image=; the last one
                        # matches the active desktop containment in practice.
                        self._kde_original = line.split("=", 1)[1].strip()
            except OSError:
                pass

    def _xfce_props(self) -> list[str]:
        listing = _out(["xfconf-query", "-c", "xfce4-desktop", "-l"])
        props = [p.strip() for p in listing.splitlines() if p.strip().endswith("/last-image")]
        if props:
            return props
        monitors: list[str] = []
        xr = _out(["xrandr", "--listmonitors"])
        for line in xr.splitlines()[1:]:
            parts = line.split()
            if parts:
                monitors.append(parts[-1])
        if not monitors:
            monitors = ["0"]
        return [f"/backdrop/screen0/monitor{m}/workspace0/last-image" for m in monitors]

    # ---------------------------------------------------------------- apply
    def apply(self, image: Path) -> bool:
        if not image.is_file():
            return False
        self.capture()
        uri = image.resolve().as_uri()
        ok = False
        if self.backend in ("gnome", "cinnamon"):
            schema = self._originals.get("schema", "org.gnome.desktop.background")
            for key in ("picture-uri", "picture-uri-dark"):
                ok = _run(["gsettings", "set", schema, key, uri]) or ok
            _run(["gsettings", "set", schema, "picture-options", "zoom"])
        elif self.backend == "mate":
            ok = _run(["gsettings", "set", "org.mate.background", "picture-filename", uri])
        elif self.backend == "xfce":
            path_str = str(image.resolve())
            for prop in self._xfce_props():
                if prop in self._originals:
                    ok = _run(["xfconf-query", "-c", "xfce4-desktop", "-p", prop, "-s", path_str]) or ok
                elif _run(["xfconf-query", "-c", "xfce4-desktop", "-p", prop, "--create", "-t", "string", "-s", path_str]):
                    if prop not in self._xfce_created:
                        self._xfce_created.append(prop)
                    style_prop = prop[:-len("/last-image")] + "/image-style"
                    if not _out(["xfconf-query", "-c", "xfce4-desktop", "-p", style_prop]).strip():
                        if _run(["xfconf-query", "-c", "xfce4-desktop", "-p", style_prop, "--create", "-t", "int", "-s", "5"]):
                            if style_prop not in self._xfce_created:
                                self._xfce_created.append(style_prop)
                    ok = True
        elif self.backend == "kde":
            ok = self._kde_apply(uri)
        elif self.backend == "feh":
            ok = _run(["feh", "--no-fehbg", "--bg-fill", str(image.resolve())])
        if not ok:
            self.log.write(f"Statik duvar kağıdı uygulanamadı (backend={self.backend})")
        return ok

    def _kde_apply(self, uri: str) -> bool:
        dbus = "qdbus6" if shutil.which("qdbus6") else "qdbus"
        if not shutil.which(dbus):
            return False
        js_uri = json.dumps(uri)
        script = (
            "var ds = desktops();"
            "for (var i = 0; i < ds.length; i++) {"
            "var d = ds[i];"
            'd.wallpaperPlugin = "org.kde.image";'
            'd.currentConfigGroup = ["Wallpaper", "org.kde.image", "General"];'
            f"d.writeConfig(\"Image\", {js_uri});"
            "}"
        )
        return _run(
            [
                dbus,
                "org.kde.plasmashell",
                "/PlasmaShell",
                "org.kde.PlasmaShell.evaluateScript",
                script,
            ]
        )

    # ---------------------------------------------------------------- restore
    def restore(self) -> None:
        if not self._captured:
            return
        if self.backend in ("gnome", "cinnamon") and "schema" in self._originals:
            schema = self._originals["schema"]
            for key in ("picture-uri", "picture-uri-dark", "picture-options"):
                value = self._originals.get(key)
                if value:
                    _run(["gsettings", "set", schema, key, value.strip("'\"")])
        elif self.backend == "mate" and "picture-filename" in self._originals:
            _run(
                [
                    "gsettings",
                    "set",
                    "org.mate.background",
                    "picture-filename",
                    self._originals["picture-filename"].strip("'\""),
                ]
            )
        elif self.backend == "xfce":
            for prop, value in self._originals.items():
                _run(
                    ["xfconf-query", "-c", "xfce4-desktop", "-p", prop, "-s", value.strip("'\"")]
                )
            for prop in self._xfce_created:
                _run(["xfconf-query", "-c", "xfce4-desktop", "-p", prop, "-r"])
        elif self.backend == "kde" and self._kde_original:
            self._kde_apply(self._kde_original)
        self.log.write("Statik duvar kağıdı geri yüklendi")
