"""Foreground fullscreen/maximized detection.

X11 is queried through xdotool/xprop. wlroots compositors (Sway) and Hyprland
expose enough state through their CLIs for Wayland. GNOME Shell and KWin do
not expose a stable public API, so on those desktops only manual pause works.
Set DESKLAND_PAUSE_HELPER to an executable that exits 0 for "pause" when a
site-specific check is needed.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

IGNORED_CLASSES = (
    "deskland",
    "nautilus",
    "nemo",
    "caja",
    "plasmashell",
    "xfdesktop",
    "gnome-shell",
    "kwin",
    "mutter",
    "sway",
    "waybar",
    "polybar",
    "plasmashell",
    "ksmserver",
)


def _run(cmd: list[str], timeout: float = 1.5) -> str | None:
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        return proc.stdout if proc.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


class PauseMonitor:
    def __init__(
        self,
        screen_x: int,
        screen_y: int,
        screen_w: int,
        screen_h: int,
        scale: int,
        log,
    ) -> None:
        self.screen = (screen_x, screen_y, screen_w, screen_h)
        self.scale = max(1, scale)
        self.log = log
        self._warned_wayland = False
        self._helper = os.environ.get("DESKLAND_PAUSE_HELPER")

    def should_pause(self) -> bool:
        if self._helper:
            try:
                proc = subprocess.run(
                    [self._helper],
                    timeout=2,
                    check=False,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                return proc.returncode == 0
            except (OSError, subprocess.SubprocessError):
                pass
        if os.environ.get("WAYLAND_DISPLAY") or os.environ.get("XDG_SESSION_TYPE") == "wayland":
            if os.environ.get("SWAYSOCK"):
                return self._sway()
            if os.environ.get("HYPRLAND_INSTANCE_SIGNATURE"):
                return self._hyprland()
            if not self._warned_wayland:
                self._warned_wayland = True
                self.log.write(
                    "Wayland: bu compositor için genel pencere sorgusu yok; "
                    "otomatik duraklatma yalnızca elle çalışır."
                )
            return False
        if os.environ.get("DISPLAY"):
            return self._x11()
        return False

    # ---------------------------------------------------------------- X11
    def _x11(self) -> bool:
        window = self._active_window()
        if not window:
            return False
        props = _run(["xprop", "-id", window, "_NET_WM_STATE", "WM_CLASS", "_NET_WM_WINDOW_TYPE"])
        if props is None:
            return False
        cls = ""
        states = ""
        wtype = ""
        for line in props.splitlines():
            if line.startswith("WM_CLASS"):
                cls = line.lower()
            elif line.startswith("_NET_WM_STATE"):
                states = line
            elif line.startswith("_NET_WM_WINDOW_TYPE"):
                wtype = line.lower()
        if any(name in cls for name in IGNORED_CLASSES):
            return False
        if "_net_wm_window_type_desktop" in wtype or "_net_wm_window_type_dock" in wtype:
            return False
        if "_NET_WM_STATE_FULLSCREEN" in states:
            return True
        if (
            "_NET_WM_STATE_MAXIMIZED_VERT" in states
            and "_NET_WM_STATE_MAXIMIZED_HORZ" in states
        ):
            return True
        return self._covers_screen(window)

    def _active_window(self) -> str | None:
        if shutil.which("xdotool"):
            out = _run(["xdotool", "getactivewindow"])
            if out and out.strip():
                return out.strip()
        out = _run(["xprop", "-root", "_NET_ACTIVE_WINDOW"])
        if not out:
            return None
        marker = "window id #"
        if marker not in out:
            return None
        return out.split(marker, 1)[1].strip().split(",", 1)[0].strip()

    def _covers_screen(self, window: str) -> bool:
        out = _run(["xdotool", "getwindowgeometry", "--shell", window])
        geometry: dict[str, int] = {}
        if out:
            for line in out.splitlines():
                if "=" not in line:
                    continue
                key, value = line.split("=", 1)
                try:
                    geometry[key.strip()] = int(value.strip())
                except ValueError:
                    pass
        if not geometry:
            out = _run(["xwininfo", "-id", window])
            if not out:
                return False
            for line in out.splitlines():
                line = line.strip()
                for key, name in (
                    ("Absolute upper-left X:", "X"),
                    ("Absolute upper-left Y:", "Y"),
                    ("Width:", "WIDTH"),
                    ("Height:", "HEIGHT"),
                ):
                    if line.startswith(key):
                        try:
                            geometry[name] = int(line.split(":", 1)[1].strip())
                        except ValueError:
                            pass
        # X11 window coordinates are device pixels.
        x = geometry.get("X", 0)
        y = geometry.get("Y", 0)
        w = geometry.get("WIDTH", 0)
        h = geometry.get("HEIGHT", 0)
        sx, sy, sw, sh = self.screen
        cx, cy = x + w // 2, y + h // 2
        inside = sx <= cx <= sx + sw and sy <= cy <= sy + sh
        covers = (
            x <= sx + sw * 0.02
            and y <= sy + sh * 0.02
            and x + w >= sx + sw * 0.98
            and y + h >= sy + sh * 0.98
        )
        return bool(inside and covers and w >= sw * 0.9 and h >= sh * 0.9)

    # ---------------------------------------------------------------- wlroots
    def _sway(self) -> bool:
        out = _run(["swaymsg", "-r", "-t", "get_tree"], timeout=2)
        if not out:
            return False
        try:
            tree = json.loads(out)
        except ValueError:
            return False
        focused = self._find_focused(tree)
        if not focused:
            return False
        app_id = str(focused.get("app_id") or focused.get("window_properties", {}).get("class") or "").lower()
        if any(name in app_id for name in IGNORED_CLASSES):
            return False
        if focused.get("fullscreen_mode"):
            return True
        rect = focused.get("rect") or {}
        return self._rect_covers(
            int(rect.get("x", 0)),
            int(rect.get("y", 0)),
            int(rect.get("width", 0)),
            int(rect.get("height", 0)),
        )

    @classmethod
    def _find_focused(cls, node: Any) -> dict[str, Any] | None:
        if not isinstance(node, dict):
            return None
        if node.get("focused"):
            return node
        for child in list(node.get("nodes") or []) + list(node.get("floating_nodes") or []):
            found = cls._find_focused(child)
            if found:
                return found
        return None

    # ---------------------------------------------------------------- Hyprland
    def _hyprland(self) -> bool:
        out = _run(["hyprctl", "activewindow", "-j"], timeout=2)
        if not out:
            return False
        try:
            data = json.loads(out)
        except ValueError:
            return False
        cls = str(data.get("class") or data.get("initialClass") or "").lower()
        if any(name in cls for name in IGNORED_CLASSES):
            return False
        if data.get("fullscreen"):
            return True
        at = data.get("at") or [0, 0]
        size = data.get("size") or [0, 0]
        try:
            return self._rect_covers(int(at[0]), int(at[1]), int(size[0]), int(size[1]))
        except (TypeError, ValueError, IndexError):
            return False

    def _rect_covers(self, x: int, y: int, w: int, h: int) -> bool:
        sx, sy, sw, sh = self.screen
        cx, cy = x + w // 2, y + h // 2
        inside = sx <= cx <= sx + sw and sy <= cy <= sy + sh
        covers = (
            x <= sx + 2
            and y <= sy + 2
            and x + w >= sx + sw - 2
            and y + h >= sy + sh - 2
        )
        return bool(inside and covers)


def helper_example() -> str:
    return (
        "#!/bin/sh\n"
        "# Return 0 when a fullscreen/maximized window should pause Deskland.\n"
        "# Example for a compositor with a custom CLI:\n"
        "exit 1\n"
    )


def write_helper_template(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(helper_example(), encoding="utf-8")
    path.chmod(0o755)
