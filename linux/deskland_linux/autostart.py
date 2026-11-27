"""XDG autostart entry management (~/.config/autostart/deskland.desktop)."""

from __future__ import annotations

import os
import shlex
import sys
from pathlib import Path

from .config import autostart_path


def command_for_autostart() -> str:
    # The installed wrapper sets PYTHONPATH and the module correctly; prefer it.
    for candidate in ("/usr/bin/deskland-linux", "/bin/deskland-linux"):
        if Path(candidate).exists():
            return f"{shlex.quote(candidate)} --autostart"
    argv0 = Path(sys.argv[0])
    try:
        resolved = argv0.resolve() if argv0.exists() else None
        if (
            resolved is not None
            and resolved.name == "__main__.py"
            and (resolved.parent / "__init__.py").exists()
        ):
            # Launched as `python -m deskland_linux`; argv0 is the package's
            # __main__.py, which cannot be exec'd directly (no shebang,
            # relative imports). Use the module form with PYTHONPATH.
            return (
                "env "
                f"PYTHONPATH={shlex.quote(str(resolved.parent.parent))} "
                f"{shlex.quote(sys.executable)} -m deskland_linux --autostart"
            )
        if resolved is not None and os.access(str(resolved), os.X_OK):
            return f"{shlex.quote(str(resolved))} --autostart"
    except OSError:
        pass
    return "deskland-linux --autostart"


def entry_text() -> str:
    exec_line = command_for_autostart()
    return (
        "[Desktop Entry]\n"
        "Type=Application\n"
        "Name=Deskland Preview\n"
        "Comment=Adaptive wallpaper that follows desktop icons\n"
        f"Exec={exec_line}\n"
        "Terminal=false\n"
        "X-GNOME-Autostart-enabled=true\n"
        "StartupNotify=false\n"
    )


def is_enabled() -> bool:
    return autostart_path().is_file()


def set_enabled(enabled: bool) -> bool:
    path = autostart_path()
    try:
        if enabled:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".tmp")
            tmp.write_text(entry_text(), encoding="utf-8")
            tmp.chmod(0o644)
            tmp.replace(path)
        elif path.exists():
            path.unlink()
        return is_enabled() == enabled
    except OSError:
        return False
