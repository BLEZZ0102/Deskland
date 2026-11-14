"""Gtk.Application orchestration for Deskland Preview on Linux."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any
from urllib.parse import quote

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gio", "2.0")

from gi.repository import Gio, GLib, Gtk  # noqa: E402

from . import autostart
from .config import (
    APP_ID,
    APP_NAME,
    SUPPORTED_LANGS,
    VERSION,
    I18n,
    Log,
    SettingsStore,
    ThemeRegistry,
    config_dir,
    desktop_dir,
    pictures_dir,
    prototype_dir,
    repo_root,
)
from .server import LocalServer
from .settings_window import SettingsWindow
from .share import copy_files, copy_image, open_path, reveal_path, save_share
from .tray import Tray
from .wallpaper import Wallpaper


def _icon_path() -> Path | None:
    candidates = (
        Path(__file__).resolve().parents[1] / "packaging" / "deskland.svg",
        repo_root() / "linux" / "packaging" / "deskland.svg",
        repo_root() / "packaging" / "deskland.svg",
        Path("/usr/share/icons/hicolor/scalable/apps/deskland.svg"),
    )
    for path in candidates:
        if path.exists():
            return path
    return None


class DesklandHost:
    def __init__(self, application: Gtk.Application) -> None:
        self.app = application
        self.version = VERSION
        self.log = Log()
        self.settings = SettingsStore()
        self.settings.load()
        self.i18n = I18n(prototype_dir(), self.settings.lang, self.log)
        self.themes = ThemeRegistry(prototype_dir(), self.log)
        self.server = LocalServer(prototype_dir(), pictures_dir() / "Deskland Preview")
        self.server.start()
        self.wallpaper: Wallpaper | None = None
        self.settings_window: SettingsWindow | None = None
        self.tray: Tray | None = None
        self.last_icons: dict[str, Any] | None = None
        self.last_share: Path | None = None
        self.manual_pause = False
        self.started = False
        self._save_timeout = 0
        self._quitting = False
        self._profile_isolated = bool(os.environ.get("DESKLAND_PROFILE_DIR"))
        self.log.write(f"Linux host başladı; veri={config_dir()}")

    # ---------------------------------------------------------------- helpers
    def desktop_dir(self) -> Path:
        return desktop_dir()

    @property
    def current_page(self) -> str:
        return self.themes.page_for(self.settings.theme) or "flat.html"

    def wallpaper_settings_message(self) -> dict[str, Any]:
        return {
            "t": "settings",
            "v": dict(self.settings.for_theme(self.settings.theme)),
        }

    def choose_theme(self) -> None:
        if self.themes.allowed(self.settings.theme):
            return
        for theme_id in ("beach", "meadow"):
            if self.themes.allowed(theme_id):
                self.settings.theme = theme_id
                self.log.write(f"Geçersiz tema; {theme_id} seçildi")
                return
        self.log.write("Yüklenecek ücretsiz tema bulunamadı")
        self.settings.theme = "beach"

    # ---------------------------------------------------------------- startup
    def start(
        self,
        show_settings: bool = True,
        backend: str = "auto",
        icon_adapter: str | None = None,
    ) -> None:
        if self.started:
            if show_settings:
                self.open_settings()
            return
        self.started = True
        # The wallpaper window is not an application window, so the
        # GApplication main loop would exit as soon as command-line handling
        # finishes without this hold.
        self.app.hold()
        self.choose_theme()
        try:
            self.wallpaper = Wallpaper(
                host=self,
                server=self.server,
                log=self.log,
                backend=backend,
                page=self.current_page,
                adapter=icon_adapter,
            )
            self.wallpaper.load_page(self.current_page)
        except Exception as exc:
            self.log.exception("Duvar kağıdı başlatılamadı", exc)
            self._show_error(self.i18n.t("errStart", msg=str(exc)))
            self.app.release()
            self.app.quit()
            return
        self.tray = Tray(
            i18n=self.i18n,
            icon_path=_icon_path(),
            on_settings=self.open_settings,
            on_pause=self.set_manual_pause,
            on_reload=self.reload,
            on_autostart=self.set_autostart,
            on_exit=self.quit,
        )
        self.tray.set_autostart(self.autostart_enabled())
        self._welcome()
        if show_settings:
            self.open_settings()

    def _welcome(self) -> None:
        flag = config_dir() / "welcome.shown"
        if flag.exists():
            return
        try:
            self.log.write(self.i18n.t("welcomeTitle"))
            flag.parent.mkdir(parents=True, exist_ok=True)
            flag.write_text("Linux\n", encoding="utf-8")
        except OSError:
            pass

    def _show_error(self, message: str) -> None:
        try:
            dialog = Gtk.MessageDialog(
                transient_for=None,
                flags=0,
                message_type=Gtk.MessageType.ERROR,
                buttons=Gtk.ButtonsType.OK,
                text=APP_NAME,
            )
            dialog.format_secondary_text(message)
            dialog.run()
            dialog.destroy()
        except Exception:
            self.log.write(message)

    # ---------------------------------------------------------------- windows
    def open_settings(self) -> None:
        if self._quitting:
            return
        if self.settings_window is None:
            url = self.server.url(f"settings.html?v={quote(self.version)}")
            self.settings_window = SettingsWindow(self, url)
        self.settings_window.show()

    def show_menu(self) -> None:
        if self.tray is not None:
            self.tray.popup()

    def reload(self) -> None:
        if self.wallpaper is not None:
            self.wallpaper.reload()
            self.log.write("Tema yeniden yüklendi")

    def set_manual_pause(self, paused: bool) -> None:
        self.manual_pause = bool(paused)
        if self.wallpaper is not None:
            self.wallpaper.set_manual_pause(self.manual_pause)
        if self.tray is not None:
            self.tray.set_paused(self.manual_pause)

    def autostart_enabled(self) -> bool:
        return False if self._profile_isolated else autostart.is_enabled()

    def set_autostart(self, enabled: bool) -> None:
        if self._profile_isolated:
            self.log.write("İzole profil: otomatik başlatma yazımı atlandı")
            return
        actual = autostart.set_enabled(enabled) and autostart.is_enabled()
        if self.tray is not None:
            self.tray.set_autostart(actual)
        self.log.write("Otomatik başlatma açık" if actual else "Otomatik başlatma kapalı")

    # ---------------------------------------------------------------- state
    def schedule_save(self) -> None:
        if self._save_timeout:
            GLib.source_remove(self._save_timeout)
        self._save_timeout = GLib.timeout_add(600, self._save_now)

    def _save_now(self) -> bool:
        self._save_timeout = 0
        self.settings.save()
        return False

    def on_icons_message(self, message: dict[str, Any]) -> None:
        self.last_icons = message
        if self.settings_window is not None:
            self.settings_window.post(message)

    def on_record_progress(self, progress: float) -> None:
        if self.settings_window is not None:
            self.settings_window.post({"t": "recProgress", "p": progress})

    # ---------------------------------------------------------------- settings protocol
    def _post_settings(self, payload: dict[str, Any]) -> None:
        if self.settings_window is not None:
            self.settings_window.post(payload)

    def on_settings_message(self, text: str) -> None:
        try:
            message = json.loads(text)
        except ValueError:
            return
        if not isinstance(message, dict):
            return
        kind = message.get("t")
        if kind == "hello":
            self._send_init()
        elif kind == "set":
            self._on_set(message)
        elif kind == "reset":
            self._on_reset(message)
        elif kind == "theme":
            self._on_theme(message)
        elif kind == "lang":
            self._on_lang(message)
        elif kind == "autostart":
            self.set_autostart(bool(message.get("v")))
            self._post_settings({"t": "autostart", "v": self.autostart_enabled()})
        elif kind == "share":
            self._share_image()
        elif kind == "shareVideo":
            self._share_video()
        elif kind == "openShare":
            if self.last_share is not None:
                open_path(self.last_share)
        elif kind == "revealShare":
            if self.last_share is not None:
                reveal_path(self.last_share)
        elif kind == "openWebsite":
            self._open_url("https://deskland.app/")
        elif kind == "updateProgram":
            self._open_url("https://deskland.app/")
        elif kind == "autostartWarnSeen":
            pass

    def _send_init(self) -> None:
        screen_w = self.wallpaper.screen_w if self.wallpaper else 1920
        screen_h = self.wallpaper.screen_h if self.wallpaper else 1080
        self._post_settings(
            {
                "t": "init",
                "theme": self.settings.theme,
                "params": self.settings.params,
                "screen": {"w": screen_w, "h": screen_h},
                "autostart": self.autostart_enabled(),
                "autostartWarn": False,
                "autostartSw": "",
                "lang": self.settings.lang,
                "langEff": self.i18n.code,
                "langSys": self.i18n.system,
            }
        )
        if self.last_icons is not None:
            self._post_settings(self.last_icons)

    def _on_set(self, message: dict[str, Any]) -> None:
        theme = message.get("theme")
        key = message.get("key")
        if not isinstance(theme, str) or not isinstance(key, str):
            return
        if not self.themes.allowed(theme):
            return
        self.settings.for_theme(theme)[key] = message.get("value")
        if theme == self.settings.theme and self.wallpaper is not None:
            self.wallpaper.set_settings({key: message.get("value")})
        self.schedule_save()

    def _on_reset(self, message: dict[str, Any]) -> None:
        theme = message.get("theme")
        if not isinstance(theme, str):
            return
        self.settings.params.pop(theme, None)
        if theme == self.settings.theme and self.wallpaper is not None:
            self.wallpaper.reset()
        self.schedule_save()
        self.log.write(f"Varsayılanlara dönüldü: {theme}")

    def _on_theme(self, message: dict[str, Any]) -> None:
        theme_id = message.get("id")
        if not isinstance(theme_id, str) or not self.themes.allowed(theme_id):
            self._post_settings({"t": "themeChanged", "id": self.settings.theme})
            self.log.write(f"Tema reddedildi: {theme_id}")
            return
        page = self.themes.page_for(theme_id)
        if not page or theme_id == self.settings.theme:
            return
        self.settings.theme = theme_id
        self.schedule_save()
        if self.wallpaper is not None:
            self.wallpaper.load_page(page)
        self.log.write(f"Tema değişti: {theme_id}")

    def _on_lang(self, message: dict[str, Any]) -> None:
        value = message.get("v")
        if not isinstance(value, str):
            return
        if value != "auto" and value not in SUPPORTED_LANGS:
            return
        self.settings.lang = value
        self.i18n.set_lang(value)
        if self.tray is not None:
            self.tray.retranslate()
        self.schedule_save()
        self._post_settings(
            {
                "t": "lang",
                "v": self.settings.lang,
                "eff": self.i18n.code,
                "sys": self.i18n.system,
            }
        )

    def _open_url(self, url: str) -> None:
        try:
            subprocess.Popen(
                ["xdg-open", url],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except OSError:
            pass

    # ---------------------------------------------------------------- share
    def _share_image(self) -> None:
        if self.wallpaper is None:
            self._post_settings(
                {"t": "shareResult", "ok": False, "msg": self.i18n.t("errNotReady")}
            )
            return

        def done(thumb: str | None, png: str | None, error: str | None) -> None:
            if error is not None or png is None:
                self._post_settings(
                    {
                        "t": "shareResult",
                        "ok": False,
                        "msg": error or self.i18n.t("errNoImage"),
                    }
                )
                return
            try:
                path = save_share(png, pictures_dir() / "Deskland Preview", "image")
                self.last_share = path
                copy_image(path)
                self._post_settings(
                    {
                        "t": "shareResult",
                        "ok": True,
                        "thumb": thumb,
                        "path": str(path),
                    }
                )
                self.log.write(f"Paylaşım görseli: {path}")
            except Exception as exc:
                self.log.exception("Paylaşım görseli kaydedilemedi", exc)
                self._post_settings(
                    {"t": "shareResult", "ok": False, "msg": str(exc)}
                )

        self.wallpaper.request_snapshot(done)

    def _share_video(self) -> None:
        if self.wallpaper is None:
            self._post_settings(
                {"t": "shareResult", "ok": False, "msg": self.i18n.t("errNotReady")}
            )
            return

        def done(
            mime: str | None,
            poster: str | None,
            video: str | None,
            error: str | None,
        ) -> None:
            if error is not None or video is None:
                self._post_settings(
                    {
                        "t": "shareResult",
                        "ok": False,
                        "msg": error or self.i18n.t("errNoVideo"),
                    }
                )
                return
            try:
                path = save_share(
                    video,
                    pictures_dir() / "Deskland Preview",
                    "video",
                    mime or "",
                )
                self.last_share = path
                copy_files([path])
                self._post_settings(
                    {
                        "t": "shareResult",
                        "ok": True,
                        "kind": "video",
                        "thumb": poster,
                        "path": str(path),
                        "url": self.server.url(f"__share/{quote(path.name)}"),
                    }
                )
                self.log.write(f"Paylaşım videosu: {path}")
            except Exception as exc:
                self.log.exception("Paylaşım videosu kaydedilemedi", exc)
                self._post_settings(
                    {"t": "shareResult", "ok": False, "msg": str(exc)}
                )

        self.wallpaper.request_record(done)

    # ---------------------------------------------------------------- quit
    def quit(self) -> None:
        if self._quitting:
            return
        self._quitting = True
        self.log.write("Çıkış")
        if self._save_timeout:
            GLib.source_remove(self._save_timeout)
        self.settings.save()
        if self.settings_window is not None:
            self.settings_window.destroy()
            self.settings_window = None
        if self.wallpaper is not None:
            self.wallpaper.shutdown()
            self.wallpaper = None
        if self.tray is not None:
            self.tray.destroy()
            self.tray = None
        self.server.stop()
        self.app.release()
        self.app.quit()


class DesklandApplication(Gtk.Application):
    def __init__(self) -> None:
        super().__init__(
            application_id=APP_ID,
            flags=Gio.ApplicationFlags.HANDLES_COMMAND_LINE,
        )
        self.host: DesklandHost | None = None
        # Do not register the custom flags with add_main_option(): GLib then
        # consumes them and do_command_line() never sees "--exit" / "--static"
        # / "--autostart" in get_arguments(). HANDLES_COMMAND_LINE leaves
        # unregistered options in the argument list for us to parse.

    def do_startup(self) -> None:
        Gtk.Application.do_startup(self)
        self.host = DesklandHost(self)

    def do_command_line(self, command_line: Gio.ApplicationCommandLine) -> int:
        args = [str(a) for a in command_line.get_arguments()[1:]]
        host = self.host
        if host is None:
            return 1
        if "--exit" in args:
            host.quit()
            return 0
        if "--menu" in args:
            host.show_menu()
            return 0
        if "--settings" in args:
            if not host.started:
                host.start(show_settings=True, **_backend_args(args))
            else:
                host.open_settings()
            return 0
        host.start(
            show_settings="--autostart" not in args,
            **_backend_args(args),
        )
        return 0

    def do_activate(self) -> None:
        if self.host is not None and not self.host.started:
            self.host.start(show_settings=True)


def _backend_args(args: list[str]) -> dict[str, str | None]:
    backend = "static" if "--static" in args else "x11" if "--x11" in args else "layer-shell" if "--layer-shell" in args else "auto"
    adapter = None
    if "--icon-adapter" in args:
        index = args.index("--icon-adapter")
        if index + 1 < len(args):
            adapter = args[index + 1]
    return {"backend": backend, "icon_adapter": adapter}


def main(argv: list[str] | None = None) -> int:
    argv = list(argv or sys.argv)
    app = DesklandApplication()
    return app.run(argv)
