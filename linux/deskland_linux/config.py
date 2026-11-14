"""Paths, settings, logging, i18n and theme registry for the Linux host."""

from __future__ import annotations

import json
import os
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

APP_NAME = "Deskland Preview"
APP_ID = "app.deskland.Preview"
VERSION = "0.1.3-linux.1"

THEME_DEFAULT = "beach"
LANG_DEFAULT = "auto"
SUPPORTED_LANGS = ("zh-CN", "en")


def repo_root() -> Path:
    """Repository root when running from source; install root when packaged."""
    return Path(__file__).resolve().parents[2]


def prototype_dir() -> Path:
    override = os.environ.get("DESKLAND_PROTOTYPE")
    if override:
        return Path(override).expanduser().resolve()
    return repo_root() / "prototype"


def config_home() -> Path:
    base = os.environ.get("XDG_CONFIG_HOME")
    return Path(base).expanduser() if base else Path.home() / ".config"


def state_home() -> Path:
    base = os.environ.get("XDG_STATE_HOME")
    return Path(base).expanduser() if base else Path.home() / ".local" / "state"


def data_home() -> Path:
    base = os.environ.get("XDG_DATA_HOME")
    return Path(base).expanduser() if base else Path.home() / ".local" / "share"


def config_dir() -> Path:
    override = os.environ.get("DESKLAND_PROFILE_DIR")
    if override:
        return Path(override).expanduser().resolve()
    return config_home() / "deskland"


def log_path() -> Path:
    return config_dir() / "host.log"


def pictures_dir() -> Path:
    override = os.environ.get("DESKLAND_PICTURES_DIR")
    if override:
        return Path(override).expanduser().resolve()
    try:
        out = subprocess.run(
            ["xdg-user-dir", "PICTURES"],
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        ).stdout.strip()
        if out and Path(out).is_dir():
            return Path(out)
    except (OSError, subprocess.SubprocessError):
        pass
    return Path.home() / "Pictures"


def desktop_dir() -> Path:
    override = os.environ.get("DESKLAND_DESKTOP_DIR")
    if override:
        return Path(override).expanduser().resolve()
    try:
        out = subprocess.run(
            ["xdg-user-dir", "DESKTOP"],
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        ).stdout.strip()
        if out and Path(out).is_dir():
            return Path(out)
    except (OSError, subprocess.SubprocessError):
        pass
    return Path.home() / "Desktop"


def autostart_path() -> Path:
    return config_home() / "autostart" / "deskland.desktop"


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


class Log:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or log_path()
        self._lock = threading.Lock()

    def write(self, message: str) -> None:
        line = time.strftime("%Y-%m-%d %H:%M:%S ") + message + "\n"
        with self._lock:
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                with self.path.open("a", encoding="utf-8") as fh:
                    fh.write(line)
            except OSError:
                pass
        if os.environ.get("DESKLAND_DEBUG"):
            try:
                print(line, end="")
            except UnicodeError:
                print(line.encode("ascii", "replace").decode("ascii"), end="")

    def exception(self, message: str, exc: BaseException) -> None:
        self.write(f"{message}: {exc!r}")


class SettingsStore:
    """theme + per-theme parameter overrides, persisted as JSON."""

    def __init__(self, directory: Path | None = None) -> None:
        self.path = (directory or config_dir()) / "settings.json"
        self.theme = THEME_DEFAULT
        self.lang = LANG_DEFAULT
        self.params: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()

    def load(self) -> None:
        try:
            if not self.path.exists():
                return
            data = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                return
            theme = data.get("theme")
            if isinstance(theme, str):
                self.theme = theme
            lang = data.get("lang")
            if isinstance(lang, str):
                self.lang = lang
            params = data.get("params")
            if isinstance(params, dict):
                self.params = {
                    str(k): dict(v)
                    for k, v in params.items()
                    if isinstance(v, dict)
                }
        except (OSError, ValueError, TypeError):
            self.theme = THEME_DEFAULT
            self.lang = LANG_DEFAULT
            self.params = {}

    def save(self) -> None:
        with self._lock:
            payload = {
                "version": 1,
                "theme": self.theme,
                "lang": self.lang,
                "params": self.params,
            }
            raw = json.dumps(payload, ensure_ascii=False, indent=1).encode("utf-8")
            try:
                atomic_write(self.path, raw)
            except OSError:
                pass

    def for_theme(self, theme: str) -> dict[str, Any]:
        return self.params.setdefault(theme, {})


class ThemeRegistry:
    def __init__(self, prototype: Path, log: Log) -> None:
        self.path = prototype / "themes.json"
        self.log = log
        self.themes: list[dict[str, Any]] = []
        self.load()

    def load(self) -> None:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            themes = data.get("themes") if isinstance(data, dict) else None
            if isinstance(themes, list):
                self.themes = [t for t in themes if isinstance(t, dict)]
        except (OSError, ValueError) as exc:
            self.log.exception("themes.json okunamadı", exc)
            self.themes = []

    def find(self, theme_id: str | None) -> dict[str, Any] | None:
        if not theme_id:
            return None
        for theme in self.themes:
            if theme.get("id") == theme_id:
                return theme
        return None

    def page_for(self, theme_id: str | None) -> str | None:
        theme = self.find(theme_id)
        if not theme or theme.get("status") != "ready":
            return None
        page = theme.get("page")
        return page if isinstance(page, str) and page else None

    def allowed(self, theme_id: str | None) -> bool:
        theme = self.find(theme_id)
        return bool(
            theme
            and theme.get("status") == "ready"
            and theme.get("product") == "free"
            and isinstance(theme.get("page"), str)
        )

    def defaults(self, theme_id: str) -> dict[str, Any]:
        theme = self.find(theme_id) or {}
        values: dict[str, Any] = {}
        if theme.get("adaptive"):
            values["adaptive"] = 1
        groups = theme.get("groups")
        if isinstance(groups, list):
            for group in groups:
                if not isinstance(group, dict):
                    continue
                for param in group.get("params") or []:
                    if isinstance(param, dict) and "key" in param:
                        values[str(param["key"])] = param.get("default")
        return values


class I18n:
    """Host-side strings from prototype/i18n/<code>.json -> host."""

    def __init__(self, prototype: Path, setting: str, log: Log) -> None:
        self.prototype = prototype
        self.log = log
        self.setting = setting
        self.system = self.detect_system()
        self.code = setting if setting in SUPPORTED_LANGS else self.system
        self._tables: dict[str, dict[str, str]] = {}

    @staticmethod
    def detect_system() -> str:
        for var in ("LANGUAGE", "LC_ALL", "LC_MESSAGES", "LANG"):
            value = os.environ.get(var, "")
            if not value:
                continue
            first = value.split(":", 1)[0].split(".", 1)[0].split("@", 1)[0]
            if first.lower().startswith("zh"):
                return "zh-CN"
            if first:
                return "en"
        return "en"

    def _load(self, code: str) -> dict[str, str]:
        if code in self._tables:
            return self._tables[code]
        table: dict[str, str] = {}
        try:
            data = json.loads(
                (self.prototype / "i18n" / f"{code}.json").read_text(encoding="utf-8")
            )
            host = data.get("host") if isinstance(data, dict) else None
            if isinstance(host, dict):
                table = {str(k): str(v) for k, v in host.items() if isinstance(v, str)}
        except (OSError, ValueError) as exc:
            self.log.exception(f"i18n/{code}.json okunamadı", exc)
        self._tables[code] = table
        return table

    def set_lang(self, setting: str) -> None:
        self.setting = setting
        self.code = setting if setting in SUPPORTED_LANGS else self.system

    def t(self, key: str, **values: Any) -> str:
        for code in (self.code, "en", "zh-CN"):
            text = self._load(code).get(key)
            if text is not None:
                for name, value in values.items():
                    text = text.replace("{" + name + "}", str(value))
                return text
        return key
