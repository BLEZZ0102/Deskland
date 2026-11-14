"""Desktop icon-position adapters.

Linux has no single cross-desktop API for desktop icon geometry. Each file
manager owns its own storage:

  * Nautilus / Desktop Icons NG / Nemo / Caja: GVfs metadata, readable with
    ``gio info -a metadata::<fm>-icon-position``.
  * Xfce: ~/.config/xfce4/desktop/icons.screen0-*.rc
  * Plasma: ~/.config/plasma-org.kde.plasma.desktop-appletsrc (best effort).

All adapters return rectangles in *physical pixels* relative to the primary
monitor origin. Positions that cannot be read fall back to a deterministic
grid so the wallpaper still has plausible icon islands.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urlparse

CELL_W = 76
CELL_H = 100
GRID_X0 = 4
GRID_Y0 = 6
TASKBAR = 48

META_KEYS = (
    "metadata::nautilus-icon-position",
    "metadata::ding-icon-position",
    "metadata::nemo-icon-position",
    "metadata::caja-icon-position",
)

_POS_RE = re.compile(r"(-?\d+(?:\.\d+)?)\s*[,;:]\s*(-?\d+(?:\.\d+)?)")
_ATTR_RE = re.compile(r"^\s+([A-Za-z0-9:_-]+):\s*(.*)$")


def _looks_like_url(value: str) -> bool:
    value = str(value)
    return value.startswith(("desktop:/", "file://", "/"))


def _clean_url_key(url: str) -> str:
    url = str(url).strip()
    if "://" in url and not url.startswith("desktop:/"):
        return unquote(urlparse(url).path)
    return url


def _xy_from_item(item, prefer_tail: bool = False) -> tuple[float, float] | None:
    if isinstance(item, dict) and "x" in item and "y" in item:
        try:
            return float(item["x"]), float(item["y"])
        except (TypeError, ValueError):
            return None
    if isinstance(item, (list, tuple)):
        if prefer_tail and len(item) >= 3:
            # changedPositions: ["1536x864", "col", "row"]
            item = item[-2:]
        if len(item) >= 2:
            try:
                return float(item[0]), float(item[1])
            except (TypeError, ValueError):
                return None
    return None


@dataclass(frozen=True)
class Rect:
    x: int
    y: int
    w: int
    h: int

    def as_array(self) -> list[int]:
        return [self.x, self.y, self.x + self.w, self.y + self.h]


def parse_position(value: str) -> tuple[float, float] | None:
    match = _POS_RE.search(value or "")
    if not match:
        return None
    return float(match.group(1)), float(match.group(2))


def desktop_entries(directory: Path) -> list[Path]:
    if not directory.is_dir():
        return []
    try:
        entries = [p for p in directory.iterdir() if not p.name.startswith(".")]
    except OSError:
        return []
    return sorted(entries, key=lambda p: p.name.lower())


def grid_rect(index: int, scale: int, screen_w: int, screen_h: int) -> Rect:
    cell_w = CELL_W * scale
    cell_h = CELL_H * scale
    usable_h = max(cell_h, screen_h - TASKBAR * scale)
    rows = max(1, usable_h // cell_h)
    col, row = divmod(index, rows)
    x = GRID_X0 * scale + col * cell_w
    y = GRID_Y0 * scale + row * cell_h
    return Rect(int(x), int(y), int(cell_w), int(cell_h))


def _rect_from_position(
    x: float, y: float, scale: int, *, physical: bool
) -> Rect:
    k = 1 if physical else scale
    return Rect(int(x * k), int(y * k), int(CELL_W * scale), int(CELL_H * scale))


def _rect_from_cell(col: float, row: float, scale: int) -> Rect:
    x = GRID_X0 * scale + int(col) * CELL_W * scale
    y = GRID_Y0 * scale + int(row) * CELL_H * scale
    return Rect(int(x), int(y), int(CELL_W * scale), int(CELL_H * scale))


class IconAdapter:
    name = "base"

    def __init__(
        self,
        desktop: Path,
        scale: int,
        screen_w: int,
        screen_h: int,
        origin_x: int = 0,
        origin_y: int = 0,
    ) -> None:
        self.desktop = desktop
        self.scale = max(1, scale)
        self.screen_w = screen_w
        self.screen_h = screen_h
        self.origin_x = origin_x
        self.origin_y = origin_y
        self._entries = desktop_entries(desktop)
        self._physical = os.environ.get("DESKLAND_ICON_POS_PHYSICAL") == "1"

    def _refresh_entries(self) -> None:
        # Rescan the desktop folder on every read: files added or moved at
        # runtime must not wait for a restart before they appear.
        try:
            self._entries = desktop_entries(self.desktop)
        except OSError:
            pass

    def _grid_for(self, path: Path, index: int, used: set[tuple[int, int]]) -> Rect:
        for candidate in range(index, index + 400):
            rect = grid_rect(candidate, self.scale, self.screen_w, self.screen_h)
            key = (rect.x, rect.y)
            if key not in used:
                used.add(key)
                return rect
        return grid_rect(index, self.scale, self.screen_w, self.screen_h)

    def read(self) -> tuple[bool, list[Rect]]:
        return True, []


class GioMetadataAdapter(IconAdapter):
    name = "gio-metadata"

    def read(self) -> tuple[bool, list[Rect]]:
        self._refresh_entries()
        if not self._entries:
            return True, []
        positions = self._read_metadata()
        used: set[tuple[int, int]] = set()
        rects: list[Rect] = []
        for index, path in enumerate(self._entries):
            pos = positions.get(str(path))
            if pos is None:
                rect = self._grid_for(path, index, used)
            else:
                rect = _rect_from_position(*pos, self.scale, physical=self._physical)
                used.add((rect.x, rect.y))
            rects.append(rect)
        return True, rects

    def _read_metadata(self) -> dict[str, tuple[float, float]]:
        paths = [str(p) for p in self._entries]
        positions: dict[str, tuple[float, float]] = {}
        for key in META_KEYS:
            # One query per key: GVfs answers with nothing at all (no error)
            # if a single requested attribute is unknown to it, which used to
            # silently break the whole batch and always report 0 positions.
            cmd = ["gio", "info", "-a", key] + paths
            try:
                proc = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=4,
                    check=False,
                )
            except (OSError, subprocess.SubprocessError):
                continue
            positions.update(self._parse_output(proc.stdout))
        return positions

    @staticmethod
    def _parse_output(text: str) -> dict[str, tuple[float, float]]:
        result: dict[str, tuple[float, float]] = {}
        current: str | None = None
        for line in text.splitlines():
            if line.startswith("uri:"):
                uri = line[4:].strip()
                parsed = urlparse(uri)
                current = unquote(parsed.path) if parsed.scheme == "file" else uri
                continue
            match = _ATTR_RE.match(line)
            if not match or current is None:
                continue
            key, value = match.group(1), match.group(2).strip()
            if key in META_KEYS:
                pos = parse_position(value)
                if pos is not None:
                    result[current] = pos
        return result


class XfceAdapter(IconAdapter):
    name = "xfce"

    def _layout_file(self) -> Path | None:
        root = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
        directory = root / "xfce4" / "desktop"
        try:
            yaml_files = sorted(directory.glob("icons.screen0*.yaml"))
            if yaml_files:
                return yaml_files[0]
            files = sorted(directory.glob("icons.screen0-*.rc"))
        except OSError:
            return None
        return files[0] if files else None

    def read(self) -> tuple[bool, list[Rect]]:
        self._refresh_entries()
        if not self._entries:
            return True, []
        found: dict[str, tuple[float, float]] = {}
        layout = self._layout_file()
        if layout is not None:
            try:
                text = layout.read_text(encoding="utf-8", errors="replace")
                if layout.suffix == ".yaml":
                    found = self._parse_yaml(text)
                else:
                    found = self._parse(text)
            except OSError:
                found = {}
        used: set[tuple[int, int]] = set()
        rects: list[Rect] = []
        for index, path in enumerate(self._entries):
            pos = found.get(str(path)) or found.get(path.name)
            if pos is None:
                rect = self._grid_for(path, index, used)
            else:
                rect = _rect_from_cell(*pos, self.scale)
                used.add((rect.x, rect.y))
            rects.append(rect)
        return True, rects

    @staticmethod
    def _unescape_yaml_key(key: str) -> str:
        if len(key) >= 2 and key[0] == '"' and key[-1] == '"':
            key = key[1:-1]
            return re.sub(
                r'\\x([0-9a-fA-F]{2})|\\u([0-9a-fA-F]{4})|\\(["\\/])',
                lambda m: (
                    chr(int(m.group(1), 16))
                    if m.group(1)
                    else chr(int(m.group(2), 16))
                    if m.group(2)
                    else m.group(3)
                ),
                key,
            )
        if len(key) >= 2 and key[0] == "'" and key[-1] == "'":
            return key[1:-1].replace("''", "'")
        return key

    @classmethod
    def _parse_yaml(cls, text: str) -> dict[str, tuple[float, float]]:
        result: dict[str, tuple[float, float]] = {}
        in_icons = False
        icons_indent = -1
        current_path: str | None = None
        cur_row: int | None = None
        cur_col: int | None = None

        def flush() -> None:
            if current_path is not None and cur_row is not None and cur_col is not None:
                result[current_path] = (cur_col, cur_row)

        for raw in text.splitlines():
            stripped = raw.strip()
            if not stripped or stripped.startswith("#"):
                continue
            indent = len(raw) - len(raw.lstrip(" "))
            if stripped == "icons:":
                flush()
                current_path = None
                in_icons = True
                icons_indent = indent
                continue
            if not in_icons:
                continue
            if indent <= icons_indent:
                flush()
                current_path = None
                in_icons = False
                continue
            if stripped.endswith(":") and indent == icons_indent + 2:
                flush()
                current_path = cls._unescape_yaml_key(stripped[:-1].strip())
                cur_row = None
                cur_col = None
            elif current_path is not None and ":" in stripped:
                k, v = stripped.split(":", 1)
                k = k.strip()
                v = v.strip()
                if k == "row":
                    try:
                        cur_row = int(v)
                    except ValueError:
                        pass
                elif k == "col":
                    try:
                        cur_col = int(v)
                    except ValueError:
                        pass
        flush()
        return result

    @staticmethod
    def _parse(text: str) -> dict[str, tuple[float, float]]:
        result: dict[str, tuple[float, float]] = {}
        section_row: int | None = None
        section_col: int | None = None
        for raw in text.splitlines():
            line = raw.strip()
            if line.startswith("[") and line.endswith("]"):
                section = line[1:-1]
                row_match = re.search(r"row\D*(\d+)", section, re.IGNORECASE)
                col_match = re.search(r"col\D*(\d+)", section, re.IGNORECASE)
                section_row = int(row_match.group(1)) if row_match else None
                section_col = int(col_match.group(1)) if col_match else None
                continue
            if "=" not in line or "file://" not in line:
                continue
            key, value = line.split("=", 1)
            value = value.strip()
            path = unquote(urlparse(value).path)
            pos = parse_position(key)
            if pos is None:
                row = re.search(r"row\D*(\d+)", key, re.IGNORECASE)
                col = re.search(r"col\D*(\d+)", key, re.IGNORECASE)
                r = int(row.group(1)) if row else section_row
                c = int(col.group(1)) if col else section_col
                if r is not None and c is not None:
                    pos = (c, r)
            if pos is not None:
                result[path] = pos
        return result


class PlasmaAdapter(IconAdapter):
    name = "plasma-best-effort"

    def _config_file(self) -> Path:
        root = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
        return root / "plasma-org.kde.plasma.desktop-appletsrc"

    def read(self) -> tuple[bool, list[Rect]]:
        self._refresh_entries()
        if not self._entries:
            return True, []
        found: dict[str, tuple[float, float]] = {}
        try:
            found = self._normalize_urls(self._parse(self._config_file().read_text(encoding="utf-8", errors="replace")))
        except OSError:
            pass
        used: set[tuple[int, int]] = set()
        rects: list[Rect] = []
        for index, path in enumerate(self._entries):
            pos = found.get(os.path.realpath(path)) or found.get(str(path)) or found.get(path.name)
            if pos is None:
                rect = self._grid_for(path, index, used)
            elif abs(pos[0]) <= 100 and abs(pos[1]) <= 100:
                rect = self._rect_from_plasma_cell(*pos)
            else:
                rect = _rect_from_position(*pos, self.scale, physical=self._physical)
            used.add((rect.x, rect.y))
            rects.append(rect)
        return True, rects

    def _rect_from_plasma_cell(self, col: float, row: float) -> Rect:
        # KDE stores folder-view positions as grid cells (e.g. "5","2") in
        # logical pixels of the screen the grid belongs to. The desktop
        # fills the whole logical screen minus the bottom panel; the exact
        # cell size is not persisted, so derive it from the geometry and
        # allow tuning via env when a layout differs.
        logical_w = max(1, self.screen_w // self.scale)
        logical_h = max(1, self.screen_h // self.scale)
        cell_w = float(os.environ.get("DESKLAND_PLASMA_CELL_W", "") or logical_w / 22)
        cell_h = float(os.environ.get("DESKLAND_PLASMA_CELL_H", "") or logical_h / 16)
        off_x = float(os.environ.get("DESKLAND_PLASMA_ORIGIN_X", "") or 0)
        off_y = float(os.environ.get("DESKLAND_PLASMA_ORIGIN_Y", "") or 0)
        k = self.scale
        return Rect(
            int((off_x + col * cell_w) * k),
            int((off_y + row * cell_h) * k),
            int(cell_w * k),
            int(cell_h * k),
        )

    def _normalize_urls(self, raw: dict[str, tuple[float, float]]) -> dict[str, tuple[float, float]]:
        out: dict[str, tuple[float, float]] = {}
        for key, pos in raw.items():
            path = self._url_to_path(key)
            if path is None:
                continue
            try:
                resolved = Path(os.path.realpath(path))
            except OSError:
                resolved = path
            out[str(resolved)] = pos
        return out

    def _url_to_path(self, url: str) -> Path | None:
        if url.startswith("desktop:/"):
            rel = unquote(url[len("desktop:/"):])
            if not rel or rel.startswith("/"):
                return None
            return Path(os.path.realpath(self.desktop / rel))
        if url.startswith("file://"):
            return Path(unquote(urlparse(url).path))
        p = Path(url)
        return p if p.is_absolute() else self.desktop / p

    @staticmethod
    def _parse(text: str) -> dict[str, tuple[float, float]]:
        result: dict[str, tuple[float, float]] = {}
        overrides: dict[str, tuple[float, float]] = {}
        for line in text.splitlines():
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip().lower()
            value = value.strip()
            if not value.startswith("{"):
                continue
            try:
                data = json.loads(value)
            except ValueError:
                continue
            if not isinstance(data, dict):
                continue
            if key == "positions":
                for screen_key, item in data.items():
                    if _looks_like_url(screen_key):
                        # Legacy: flat {url: [x, y] | {"x":…,"y":…}}
                        pos = _xy_from_item(item)
                        if pos is not None:
                            result[_clean_url_key(screen_key)] = pos
                        continue
                    if isinstance(item, dict):
                        # Legacy nested: {"screen": {url: xy}}
                        for url, xy in item.items():
                            pos = _xy_from_item(xy)
                            if pos is not None:
                                result[_clean_url_key(url)] = pos
                        continue
                    if isinstance(item, list):
                        # KDE Plasma 6 folder view: {"1536x864": ["x","y",
                        # "desktop:/file", ...]} — flat [col, row, url]
                        # triples as strings. A trailing incomplete pair may
                        # be present and is ignored.
                        for i in range(0, len(item) - 2, 3):
                            try:
                                x = float(item[i])
                                y = float(item[i + 1])
                            except (TypeError, ValueError):
                                continue
                            url = str(item[i + 2])
                            if _looks_like_url(url):
                                result[_clean_url_key(url)] = (x, y)
                        continue
            elif key == "changedpositions":
                for url, item in data.items():
                    pos = _xy_from_item(item, prefer_tail=True)
                    if pos is not None:
                        overrides[_clean_url_key(url)] = pos
        # changedPositions is a delta on top of positions; it wins.
        result.update(overrides)
        return result


class GridAdapter(IconAdapter):
    name = "grid-fallback"

    def read(self) -> tuple[bool, list[Rect]]:
        self._refresh_entries()
        used: set[tuple[int, int]] = set()
        return True, [self._grid_for(p, i, used) for i, p in enumerate(self._entries)]


def make_adapter(
    desktop: Path,
    scale: int,
    screen_w: int,
    screen_h: int,
    origin_x: int = 0,
    origin_y: int = 0,
    forced: str | None = None,
) -> IconAdapter:
    forced = (forced or os.environ.get("DESKLAND_ICON_ADAPTER") or "").lower()
    desktop_env = (
        os.environ.get("XDG_CURRENT_DESKTOP", "")
        + " "
        + os.environ.get("DESKTOP_SESSION", "")
    ).lower()
    common = dict(
        desktop=desktop,
        scale=scale,
        screen_w=screen_w,
        screen_h=screen_h,
        origin_x=origin_x,
        origin_y=origin_y,
    )
    if forced == "grid":
        return GridAdapter(**common)
    if forced == "xfce" or "xfce" in desktop_env:
        return XfceAdapter(**common)
    if forced == "plasma" or "kde" in desktop_env or "plasma" in desktop_env:
        return PlasmaAdapter(**common)
    return GioMetadataAdapter(**common)
