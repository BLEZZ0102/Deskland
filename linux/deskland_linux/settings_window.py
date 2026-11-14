"""Native settings window hosting prototype/settings.html in WebKitGTK."""

from __future__ import annotations

from typing import Any

import gi

gi.require_version("Gtk", "3.0")

from gi.repository import Gtk  # noqa: E402

from .bridge import BridgeWebView  # noqa: E402


class SettingsWindow:
    def __init__(self, host: Any, url: str) -> None:
        self.host = host
        self.url = url
        self.bridge = BridgeWebView(self.host.on_settings_message)
        self.window = Gtk.Window(type=Gtk.WindowType.TOPLEVEL)
        self.window.set_title("Deskland Preview")
        self.window.set_default_size(1120, 800)
        self.window.set_size_request(940, 680)
        self.window.set_position(Gtk.WindowPosition.CENTER)
        self.window.add(self.bridge.webview)
        self.window.connect("delete-event", self._on_delete)
        self._loaded = False

    def _on_delete(self, _window, _event) -> bool:
        self.window.hide()
        return True

    def show(self) -> None:
        if not self._loaded:
            self._loaded = True
            self.bridge.load_uri(self.url)
        self.window.show_all()
        self.window.present()

    def hide(self) -> None:
        self.window.hide()

    def post(self, payload: Any) -> None:
        self.bridge.post(payload)

    def destroy(self) -> None:
        try:
            self.window.destroy()
        except Exception:
            pass
