"""System tray controls via Ayatana AppIndicator, with StatusIcon fallback."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

import gi

gi.require_version("Gtk", "3.0")
from gi.repository import Gtk  # noqa: E402


def _load_indicator():
    try:
        gi.require_version("AyatanaAppIndicator3", "0.1")
        from gi.repository import AyatanaAppIndicator3 as indicator  # noqa: F401

        return indicator
    except (ValueError, ImportError):
        pass
    try:
        gi.require_version("AppIndicator3", "0.1")
        from gi.repository import AppIndicator3 as indicator  # noqa: F401

        return indicator
    except (ValueError, ImportError):
        return None


class Tray:
    def __init__(
        self,
        i18n: Any,
        icon_path: Path | None,
        on_settings: Callable[[], None],
        on_pause: Callable[[bool], None],
        on_reload: Callable[[], None],
        on_autostart: Callable[[bool], None],
        on_exit: Callable[[], None],
    ) -> None:
        self.i18n = i18n
        self.on_pause = on_pause
        self.on_autostart = on_autostart
        self._indicator = None
        self._status_icon = None
        self._menu = Gtk.Menu()

        self.settings_item = Gtk.MenuItem(label=i18n.t("traySettings"))
        self.settings_item.connect("activate", lambda *_: on_settings())
        self.pause_item = Gtk.CheckMenuItem(label=i18n.t("trayPause"))
        self.pause_item.connect("toggled", self._pause_toggled)
        self.reload_item = Gtk.MenuItem(label=i18n.t("trayReload"))
        self.reload_item.connect("activate", lambda *_: on_reload())
        self.autostart_item = Gtk.CheckMenuItem(label=i18n.t("trayAutostart"))
        self.autostart_item.connect("toggled", self._autostart_toggled)
        self.exit_item = Gtk.MenuItem(label=i18n.t("trayExit"))
        self.exit_item.connect("activate", lambda *_: on_exit())

        self._menu.append(self.settings_item)
        self._menu.append(self.pause_item)
        self._menu.append(self.reload_item)
        self._menu.append(self.autostart_item)
        self._menu.append(Gtk.SeparatorMenuItem())
        self._menu.append(self.exit_item)
        self._menu.show_all()

        module = _load_indicator()
        icon = str(icon_path) if icon_path and icon_path.exists() else "applications-multimedia"
        if module is not None:
            self._indicator = module.Indicator.new(
                "deskland-preview",
                icon,
                module.IndicatorCategory.APPLICATION_STATUS,
            )
            self._indicator.set_status(module.IndicatorStatus.ACTIVE)
            self._indicator.set_menu(self._menu)
            set_full = getattr(self._indicator, "set_icon_full", None)
            if callable(set_full):
                try:
                    set_full(icon, "Deskland Preview")
                except (TypeError, ValueError):
                    pass
        else:
            try:
                self._status_icon = Gtk.StatusIcon.new_from_file(str(icon_path))
                self._status_icon.set_tooltip_text("Deskland Preview")
                self._status_icon.connect("activate", lambda *_: on_settings())
                self._status_icon.connect("popup-menu", lambda *_: self.popup())
                self._status_icon.set_visible(True)
            except Exception:
                self._status_icon = None

    def _pause_toggled(self, item: Gtk.CheckMenuItem) -> None:
        self.on_pause(bool(item.get_active()))

    def _autostart_toggled(self, item: Gtk.CheckMenuItem) -> None:
        self.on_autostart(bool(item.get_active()))

    def set_paused(self, paused: bool) -> None:
        if bool(self.pause_item.get_active()) != paused:
            self.pause_item.handler_block_by_func(self._pause_toggled)
            self.pause_item.set_active(paused)
            self.pause_item.handler_unblock_by_func(self._pause_toggled)

    def set_autostart(self, enabled: bool) -> None:
        if bool(self.autostart_item.get_active()) != enabled:
            self.autostart_item.handler_block_by_func(self._autostart_toggled)
            self.autostart_item.set_active(enabled)
            self.autostart_item.handler_unblock_by_func(self._autostart_toggled)

    def retranslate(self) -> None:
        self.settings_item.set_label(self.i18n.t("traySettings"))
        self.pause_item.set_label(self.i18n.t("trayPause"))
        self.reload_item.set_label(self.i18n.t("trayReload"))
        self.autostart_item.set_label(self.i18n.t("trayAutostart"))
        self.exit_item.set_label(self.i18n.t("trayExit"))

    def popup(self) -> None:
        try:
            self._menu.popup_at_pointer(None)
        except AttributeError:
            self._menu.popup(None, None, None, None, 0, Gtk.get_current_event_time())

    def destroy(self) -> None:
        if self._indicator is not None:
            try:
                self._indicator.set_status(0)
            except Exception:
                pass
        if self._status_icon is not None:
            try:
                self._status_icon.set_visible(False)
            except Exception:
                pass
