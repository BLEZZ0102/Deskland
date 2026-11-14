"""Privacy-preserving share export and clipboard/file-manager integration."""

from __future__ import annotations

import base64
import shutil
import subprocess
import time
from pathlib import Path


def data_url_bytes(data_url: str) -> bytes:
    comma = data_url.find(",")
    payload = data_url[comma + 1 :] if comma >= 0 else data_url
    return base64.b64decode(payload)


def save_share(data_url: str, directory: Path, kind: str, mime: str = "") -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y-%m-%d %H%M%S")
    if kind == "video":
        ext = ".webm" if "webm" in mime else ".mp4"
    else:
        ext = ".png"
    path = directory / f"Deskland {stamp}{ext}"
    path.write_bytes(data_url_bytes(data_url))
    return path


def copy_image(path: Path) -> None:
    try:
        import gi

        gi.require_version("Gtk", "3.0")
        from gi.repository import Gdk, GdkPixbuf, Gtk

        pixbuf = GdkPixbuf.Pixbuf.new_from_file(str(path))
        clipboard = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)
        clipboard.set_image(pixbuf)
        clipboard.store()
    except Exception:
        pass


def copy_files(paths: list[Path]) -> None:
    try:
        import gi

        gi.require_version("Gtk", "3.0")
        from gi.repository import Gdk, Gtk

        clipboard = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)
        clipboard.set_uris([p.resolve().as_uri() for p in paths])
        clipboard.store()
    except Exception:
        pass


def open_path(path: Path) -> bool:
    if not path.exists():
        return False
    try:
        subprocess.Popen(["xdg-open", str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except OSError:
        return False


def reveal_path(path: Path) -> bool:
    if not path.exists():
        return False
    candidates = (
        ("nautilus", "--select", str(path)),
        ("nemo", "--select", str(path)),
        ("caja", "--select", str(path)),
        ("dolphin", "--select", str(path)),
        ("thunar", str(path.parent)),
    )
    for name, *args in candidates:
        if not shutil.which(name):
            continue
        try:
            subprocess.Popen([name, *args], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return True
        except OSError:
            continue
    return open_path(path.parent)
