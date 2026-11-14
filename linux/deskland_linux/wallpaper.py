"""Wallpaper surface: WebKit page + X11/layer-shell/static attachment."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Callable

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")

from gi.repository import Gdk, GLib, Gtk  # noqa: E402

from .bridge import BridgeWebView  # noqa: E402
from .config import config_dir  # noqa: E402
from .icons import make_adapter  # noqa: E402
from .pause import PauseMonitor  # noqa: E402
from .static_wallpaper import StaticWallpaper  # noqa: E402


def load_layer_shell():
    try:
        gi.require_version("GtkLayerShell", "0.1")
        from gi.repository import GtkLayerShell  # noqa: F401

        return GtkLayerShell
    except (ValueError, ImportError):
        return None


def _has_plasma_wallpaper_plugin(plugin_id: str = "org.deskland.preview") -> bool:
    data_home = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    candidates = [data_home / "plasma" / "wallpapers" / plugin_id]
    for base in os.environ.get("XDG_DATA_DIRS", "/usr/local/share:/usr/share").split(":"):
        if base:
            candidates.append(Path(base) / "plasma" / "wallpapers" / plugin_id)
    return any((c / "metadata.json").is_file() for c in candidates)


def primary_geometry() -> tuple[Any, int]:
    display = Gdk.Display.get_default()
    if display is None:
        raise RuntimeError("GDK display yok")
    monitor = display.get_primary_monitor() or display.get_monitor(0)
    if monitor is None:
        raise RuntimeError("Monitör bulunamadı")
    return monitor.get_geometry(), max(1, monitor.get_scale_factor())


class Wallpaper:
    """Owns the wallpaper view and all host <-> page messages."""

    def __init__(
        self,
        host: Any,
        server: Any,
        log: Any,
        backend: str = "auto",
        page: str = "flat.html",
        adapter: str | None = None,
    ) -> None:
        self.host = host
        self.server = server
        self.log = log
        self._page = page
        self._adapter_lock = threading.Lock()
        self._adapter = adapter
        self._last_icons: str | None = None
        self._last_pause: int = -1
        self._manual_pause = False
        self._ready = False
        self._icon_busy = False
        self._pause_busy = False
        self._snapshot_done: Callable[[str | None, str | None, str | None], None] | None = None
        self._snapshot_timeout = 0
        self._record_done: Callable[[str | None, str | None, str | None, str | None], None] | None = None
        self._record_timeout = 0
        self._static_timeout = 0
        self._static_file: Path | None = None
        self._static_snapshot_pending = False
        self._closed = False

        geo, scale = primary_geometry()
        self.geo = geo
        self.scale = scale
        self.screen_w = geo.width * scale
        self.screen_h = geo.height * scale
        self.monitor = (
            Gdk.Display.get_default().get_primary_monitor()
            or Gdk.Display.get_default().get_monitor(0)
        )
        self.icon_adapter = make_adapter(
            self.host.desktop_dir(),
            scale,
            self.screen_w,
            self.screen_h,
            origin_x=geo.x,
            origin_y=geo.y,
            forced=self._adapter,
        )
        self.pause_monitor = PauseMonitor(
            geo.x * scale,
            geo.y * scale,
            self.screen_w,
            self.screen_h,
            scale,
            log,
        )
        self.backend = self._select_backend(backend)
        self.static_wallpaper = StaticWallpaper(log)

        self.bridge = BridgeWebView(self._on_message)
        self.web = self.bridge.webview
        self.window: Gtk.Window | None = None
        self._create_surface()
        self.log.write(
            f"Duvar kağıdı yüzeyi: backend={self.backend}, "
            f"ekran={self.screen_w}x{self.screen_h}@{scale}, "
            f"simge adaptörü={self.icon_adapter.name}"
        )
        GLib.timeout_add(400, self._poll_icons)
        GLib.timeout_add(500, self._poll_pause)

    # ---------------------------------------------------------------- surface
    def _select_backend(self, requested: str) -> str:
        if requested in ("layer-shell", "x11", "static", "plasma-plugin"):
            return requested
        wayland = bool(os.environ.get("WAYLAND_DISPLAY"))
        desktop_env = (
            os.environ.get("XDG_CURRENT_DESKTOP", "")
            + " "
            + os.environ.get("DESKTOP_SESSION", "")
        ).lower()
        if ("kde" in desktop_env or "plasma" in desktop_env) and _has_plasma_wallpaper_plugin():
            return "plasma-plugin"
        if wayland and load_layer_shell() is not None:
            # KWin and GNOME Shell keep their own desktop/containment surface
            # above the layer-shell background layer, so the scene would be
            # hidden. Their supported route is a real (static) wallpaper.
            if "kde" in desktop_env or "plasma" in desktop_env or "gnome" in desktop_env:
                return "static"
            return "layer-shell"
        if os.environ.get("DISPLAY"):
            # xfdesktop renders both wallpaper and icons inside one opaque
            # DESKTOP window, so an X11 window either covers icons or is
            # hidden behind xfdesktop. Use the static xfconf backend instead.
            if "xfce" in desktop_env:
                return "static"
            return "x11"
        return "static"

    def _ensure_plasma_plugin(self) -> None:
        dbus = "qdbus6" if shutil.which("qdbus6") else "qdbus"
        if not shutil.which(dbus):
            return
        script = (
            "var ds = desktops();"
            "for (var i = 0; i < ds.length; i++) {"
            'if (ds[i].wallpaperPlugin !== "org.deskland.preview") {'
            'ds[i].wallpaperPlugin = "org.deskland.preview";'
            "}"
            "}"
        )
        try:
            subprocess.run(
                [
                    dbus,
                    "org.kde.plasmashell",
                    "/PlasmaShell",
                    "org.kde.PlasmaShell.evaluateScript",
                    script,
                ],
                capture_output=True,
                timeout=5,
                check=False,
            )
        except (OSError, subprocess.SubprocessError):
            pass

    def _create_surface(self) -> None:
        if self.backend == "plasma-plugin":
            # org.deskland.preview renders live inside plasmashell and reads
            # settings.json + icons.json directly. Keep an invisible, paused
            # surface only so share snapshots/recordings still work, and never
            # touch StaticWallpaper (which would overwrite wallpaperPlugin with
            # org.kde.image).
            self._ensure_plasma_plugin()
            surface = Gtk.Window(type=Gtk.WindowType.TOPLEVEL)
            surface.set_title("DesklandRender")
            surface.set_decorated(False)
            surface.set_resizable(False)
            surface.set_skip_taskbar_hint(True)
            surface.set_skip_pager_hint(True)
            surface.set_accept_focus(False)
            surface.set_focus_on_map(False)
            surface.set_can_focus(False)
            surface.set_opacity(0.0)
            surface.set_size_request(self.geo.width, self.geo.height)
            surface.connect("realize", self._on_realize)
            surface.add(self.web)
            surface.show_all()
            self.window = surface
            self.log.write("KDE Plasma duvar kağıdı eklentisi aktif: org.deskland.preview")
            return
        if self.backend == "static":
            # OffscreenWindow has no GdkWindow, so WebKitGTK cannot create a
            # GL context and aborts. Use a real mapped window that is fully
            # transparent and non-interactive: WebKit still renders (and can
            # be snapshotted) but the user never sees it.
            surface = Gtk.Window(type=Gtk.WindowType.TOPLEVEL)
            surface.set_title("DesklandRender")
            surface.set_decorated(False)
            surface.set_resizable(False)
            surface.set_skip_taskbar_hint(True)
            surface.set_skip_pager_hint(True)
            surface.set_accept_focus(False)
            surface.set_focus_on_map(False)
            surface.set_can_focus(False)
            surface.set_opacity(0.0)
            surface.set_size_request(self.geo.width, self.geo.height)
            surface.connect("realize", self._on_realize)
            surface.add(self.web)
            surface.show_all()
            self.window = surface
            self.log.write("Statik fallback: GNOME/KWin Wayland veya --static")
            return

        window = Gtk.Window(type=Gtk.WindowType.TOPLEVEL)
        window.set_title("DesklandWallpaper")
        window.set_decorated(False)
        window.set_resizable(False)
        window.set_skip_taskbar_hint(True)
        window.set_skip_pager_hint(True)
        window.set_accept_focus(False)
        window.set_focus_on_map(False)
        window.set_can_focus(False)
        window.connect("realize", self._on_realize)

        if self.backend == "layer-shell":
            layer_shell = load_layer_shell()
            if layer_shell is None:
                self.backend = "x11" if os.environ.get("DISPLAY") else "static"
                return self._create_surface()
            layer_shell.init_for_window(window)
            layer_shell.set_namespace(window, "deskland")
            layer = layer_shell.Layer.BACKGROUND
            override = os.environ.get("DESKLAND_LAYER", "").lower()
            if override in ("background", "bottom", "top", "overlay"):
                layer = getattr(layer_shell.Layer, override.upper())
            layer_shell.set_layer(window, layer)
            for edge in (
                layer_shell.Edge.TOP,
                layer_shell.Edge.BOTTOM,
                layer_shell.Edge.LEFT,
                layer_shell.Edge.RIGHT,
            ):
                layer_shell.set_anchor(window, edge, True)
            layer_shell.set_exclusive_zone(window, -1)
            layer_shell.set_keyboard_mode(window, layer_shell.KeyboardMode.NONE)
            if self.monitor is not None:
                layer_shell.set_monitor(window, self.monitor)
        else:
            window.set_type_hint(Gdk.WindowTypeHint.DESKTOP)
            window.set_keep_below(True)
            window.stick()
            window.set_default_size(self.geo.width, self.geo.height)
            window.set_size_request(self.geo.width, self.geo.height)
            window.move(self.geo.x, self.geo.y)
            window.resize(self.geo.width, self.geo.height)

        window.add(self.web)
        window.show_all()
        self.window = window
        if self.backend == "x11":
            GLib.timeout_add_seconds(2, self._keep_below)

    def _on_realize(self, window: Gtk.Window) -> None:
        gdk_window = window.get_window()
        if gdk_window is None:
            return
        try:
            gdk_window.set_pass_through(True)
        except (AttributeError, TypeError):
            pass
        if self.backend == "x11":
            try:
                gdk_window.set_type_hint(Gdk.WindowTypeHint.DESKTOP)
                gdk_window.lower()
            except (AttributeError, TypeError):
                pass
        else:
            try:
                import cairo

                gdk_window.input_shape_combine_region(cairo.Region())
            except (ImportError, AttributeError, TypeError):
                pass

    def _keep_below(self) -> bool:
        if self._closed or self.backend != "x11" or self.window is None:
            return False
        gdk_window = self.window.get_window()
        if gdk_window is not None:
            try:
                gdk_window.lower()
            except (AttributeError, TypeError):
                pass
        return True

    # ---------------------------------------------------------------- pages
    @property
    def page(self) -> str:
        return self._page

    def url_for(self, page: str | None = None) -> str:
        page = page or self._page
        return self.server.url(f"{page}?wallpaper=1&v={self.host.version}")

    def load_page(self, page: str) -> None:
        self._page = page
        self._ready = False
        self._last_icons = None
        self._last_pause = -1
        self.bridge.load_uri(self.url_for(page))
        self.log.write(f"Tema sayfası yüklendi: {page}")

    def reload(self) -> None:
        self._ready = False
        self._last_icons = None
        self._last_pause = -1
        self.bridge.reload()

    # ---------------------------------------------------------------- messages
    def _on_message(self, text: str) -> None:
        if text == "ready":
            self._on_ready()
            return
        if text.startswith("snapshot|"):
            self._on_snapshot(text)
            return
        if text.startswith("recprogress|"):
            try:
                self.host.on_record_progress(float(text.split("|", 1)[1]))
            except ValueError:
                pass
            return
        if text.startswith("record|"):
            self._on_record(text)
            return
        try:
            message = json.loads(text)
        except ValueError:
            return
        if not isinstance(message, dict):
            return
        if message.get("t") == "ready":
            self._on_ready()

    def _on_ready(self) -> None:
        self._ready = True
        self.bridge.post(self.host.wallpaper_settings_message())
        self._last_icons = None
        self._last_pause = -1
        self._kick_polls()

    def _kick_polls(self) -> None:
        GLib.idle_add(self._poll_icons_once)
        GLib.idle_add(self._poll_pause_once)

    def set_settings(self, values: dict[str, Any]) -> None:
        if values:
            self.bridge.post({"t": "settings", "v": values})
            if self.backend == "static":
                self._schedule_static_render(400)

    def reset(self) -> None:
        self.bridge.post({"t": "reset"})
        if self.backend == "static":
            self._schedule_static_render(400)

    def set_manual_pause(self, value: bool) -> None:
        self._manual_pause = bool(value)
        self._last_pause = -1
        self._poll_pause_once()

    # ---------------------------------------------------------------- icons
    def _poll_icons(self) -> bool:
        if self._closed:
            return False
        if self._icon_busy:
            return True
        self._icon_busy = True
        threading.Thread(target=self._read_icons, daemon=True).start()
        return True

    def _read_icons(self) -> None:
        try:
            visible, rects = self.icon_adapter.read()
            message = {
                "t": "icons",
                "vis": bool(visible),
                "r": [rect.as_array() for rect in rects],
            }
        except Exception as exc:  # adapter must never kill the timer
            self.log.exception("Simge okuma hatası", exc)
            message = None
        GLib.idle_add(self._apply_icons, message)

    def _poll_icons_once(self) -> bool:
        if not self._icon_busy:
            self._poll_icons()
        return False

    def _apply_icons(self, message: dict[str, Any] | None) -> bool:
        self._icon_busy = False
        if message is None or self._closed:
            return False
        encoded = json.dumps(message, ensure_ascii=False, separators=(",", ":"))
        if encoded == self._last_icons:
            return False
        self._last_icons = encoded
        if self._ready:
            self.bridge.post(encoded)
        self.host.on_icons_message(message)
        if self.backend == "static":
            # Wait past flat.html/meadow.html morph duration (2600ms first, 1800ms updates)
            delay = 2800 if self._static_file is None else 2000
            self._schedule_static_render(delay)
        self.log.write(f"Simge değişimi: {len(message['r'])} adet")
        return False

    # ---------------------------------------------------------------- pause
    def _poll_pause(self) -> bool:
        if self._closed:
            return False
        if self._pause_busy:
            return True
        self._pause_busy = True
        threading.Thread(target=self._read_pause, daemon=True).start()
        return True

    def _read_pause(self) -> None:
        try:
            auto = self.pause_monitor.should_pause()
        except Exception as exc:
            self.log.exception("Duraklatma algılama hatası", exc)
            auto = False
        GLib.idle_add(self._apply_pause, auto)

    def _poll_pause_once(self) -> bool:
        if not self._pause_busy:
            self._poll_pause()
        return False

    def _apply_pause(self, auto: bool) -> bool:
        self._pause_busy = False
        if self._closed:
            return False
        pause = True if self.backend == "plasma-plugin" else bool(auto or self._manual_pause)
        value = 1 if pause else 0
        if value == self._last_pause:
            return False
        self._last_pause = value
        if self._ready:
            self.bridge.post({"t": "pause", "v": pause})
            if pause and self.backend == "static":
                # Pages snap morph curMix=1 immediately on pause (settlePaused).
                self._schedule_static_render(250)
        self.log.write("Duraklatıldı" if pause else "Devam ediyor")
        return False

    # ---------------------------------------------------------------- share
    def request_snapshot(
        self, done: Callable[[str | None, str | None, str | None], None]
    ) -> None:
        if not self._ready:
            done(None, None, self.host.i18n.t("errNotReady"))
            return
        if self._snapshot_done is not None:
            done(None, None, self.host.i18n.t("errBusyImage"))
            return
        self._snapshot_done = done
        self._snapshot_timeout = GLib.timeout_add_seconds(
            20, self._snapshot_timed_out
        )
        self.bridge.post({"t": "snapshot"})

    def _snapshot_timed_out(self) -> bool:
        self._finish_snapshot(None, None, self.host.i18n.t("errImageTimeout"))
        self._snapshot_timeout = 0
        return False

    def _on_snapshot(self, text: str) -> None:
        parts = text.split("|", 2)
        if len(parts) < 3:
            self._finish_snapshot(None, None, self.host.i18n.t("errBadData"))
        elif parts[1] == "error":
            self._finish_snapshot(None, None, parts[2])
        else:
            self._finish_snapshot(parts[1], parts[2], None)

    def _finish_snapshot(
        self, thumb: str | None, png: str | None, error: str | None
    ) -> None:
        if self._snapshot_timeout:
            GLib.source_remove(self._snapshot_timeout)
            self._snapshot_timeout = 0
        done = self._snapshot_done
        self._snapshot_done = None
        if done is not None:
            done(thumb, png, error)

    def request_record(
        self,
        done: Callable[[str | None, str | None, str | None, str | None], None],
    ) -> None:
        if not self._ready:
            done(None, None, None, self.host.i18n.t("errNotReady"))
            return
        if self._record_done is not None:
            done(None, None, None, self.host.i18n.t("errBusyVideo"))
            return
        self._record_done = done
        self._record_timeout = GLib.timeout_add_seconds(45, self._record_timed_out)
        self.bridge.post({"t": "record"})

    def _record_timed_out(self) -> bool:
        self._finish_record(None, None, None, self.host.i18n.t("errVideoTimeout"))
        self._record_timeout = 0
        return False

    def _on_record(self, text: str) -> None:
        parts = text.split("|", 3)
        if len(parts) >= 3 and parts[1] == "error":
            self._finish_record(None, None, None, parts[2])
        elif len(parts) < 4:
            self._finish_record(None, None, None, self.host.i18n.t("errBadData"))
        else:
            self._finish_record(parts[1], parts[2], parts[3], None)

    def _finish_record(
        self,
        mime: str | None,
        poster: str | None,
        video: str | None,
        error: str | None,
    ) -> None:
        if self._record_timeout:
            GLib.source_remove(self._record_timeout)
            self._record_timeout = 0
        done = self._record_done
        self._record_done = None
        if done is not None:
            done(mime, poster, video, error)

    # ---------------------------------------------------------------- static
    def _schedule_static_render(self, delay_ms: int = 2000) -> None:
        if self.backend != "static" or self._closed:
            return
        if self._static_timeout:
            GLib.source_remove(self._static_timeout)
        self._static_timeout = GLib.timeout_add(delay_ms, self._static_render)

    def _static_render(self) -> bool:
        self._static_timeout = 0
        if self._closed:
            return False
        if self._last_pause == 1 and self._ready and not self._static_snapshot_pending:
            # WebKitGTK only composites WebGL canvas updates inside a
            # requestAnimationFrame tick; briefly unpause so one frame paints.
            self._static_snapshot_pending = True
            self.bridge.post({"t": "pause", "v": False})
            self._static_timeout = GLib.timeout_add(160, self._static_render)
            return False
        self._static_snapshot_pending = False
        try:
            self.web.get_snapshot(
                self.web.get_snapshot_region() if hasattr(self.web, "get_snapshot_region") else 0,
                0,
                None,
                self._snapshot_finished,
                None,
            )
        except (TypeError, AttributeError):
            # Older/newer Web signatures vary; retry with explicit enums.
            try:
                from gi.repository import WebKit2

                self.web.get_snapshot(
                    WebKit2.SnapshotRegion.VISIBLE,
                    WebKit2.SnapshotOptions.NONE,
                    None,
                    self._snapshot_finished,
                    None,
                )
            except Exception as exc:
                self.log.exception("Statik kare alınamadı", exc)
        return False

    def _snapshot_finished(self, webview, result, _user_data) -> None:
        if self._last_pause == 1 and self._ready and not self._closed:
            self.bridge.post({"t": "pause", "v": True})
        try:
            surface = webview.get_snapshot_finish(result)
        except Exception as exc:
            self.log.exception("Snapshot tamamlanamadı", exc)
            return
        if surface is None:
            return
        # A new filename each time: Plasma (and some other desktops) cache the
        # wallpaper texture by URI, so rewriting render.png would keep showing
        # the previous frame after a theme or icon change.
        target = config_dir() / f"render-{int(time.time() * 1000)}.png"
        try:
            surface.write_to_png(str(target))
        except Exception as exc:
            self.log.exception("render.png yazılamadı", exc)
            return
        if self.static_wallpaper.apply(target):
            previous = self._static_file
            self._static_file = target
            if previous is not None and previous != target:
                try:
                    previous.unlink()
                except OSError:
                    pass

    # ---------------------------------------------------------------- lifecycle
    def shutdown(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self._snapshot_timeout:
            GLib.source_remove(self._snapshot_timeout)
        if self._record_timeout:
            GLib.source_remove(self._record_timeout)
        if self._static_timeout:
            GLib.source_remove(self._static_timeout)
        self.static_wallpaper.restore()
        if self._static_file is not None:
            try:
                self._static_file.unlink()
            except OSError:
                pass
            self._static_file = None
        if self.window is not None:
            try:
                self.window.destroy()
            except Exception:
                pass
            self.window = None
