"""Loopback HTTP server for the prototype pages and generated share files."""

from __future__ import annotations

import mimetypes
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("text/javascript", ".mjs")


class _Handler(SimpleHTTPRequestHandler):
    share_dir: Path

    def __init__(self, *args, directory: str, share_dir: Path, **kwargs) -> None:
        self.share_dir = share_dir
        super().__init__(*args, directory=directory, **kwargs)

    def do_GET(self) -> None:  # noqa: N802 - stdlib name
        path = unquote(urlparse(self.path).path)
        if path.startswith("/__share/"):
            name = Path(path[len("/__share/") :]).name
            target = (self.share_dir / name).resolve()
            try:
                target.relative_to(self.share_dir.resolve())
            except ValueError:
                self.send_error(403)
                return
            if not target.is_file():
                self.send_error(404)
                return
            data = target.read_bytes()
            ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()

    def log_message(self, fmt: str, *args) -> None:
        return


class LocalServer:
    def __init__(self, prototype: Path, share_dir: Path) -> None:
        self.prototype = prototype
        self.share_dir = share_dir
        self.httpd: ThreadingHTTPServer | None = None
        self.thread: threading.Thread | None = None
        self.port = 0

    def start(self) -> int:
        if self.httpd is not None:
            return self.port
        handler = lambda *args, **kwargs: _Handler(  # noqa: E731
            *args,
            directory=str(self.prototype),
            share_dir=self.share_dir,
            **kwargs,
        )
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.httpd.daemon_threads = True
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(
            target=self.httpd.serve_forever,
            name="deskland-http",
            daemon=True,
        )
        self.thread.start()
        return self.port

    def stop(self) -> None:
        if self.httpd is None:
            return
        try:
            self.httpd.shutdown()
            self.httpd.server_close()
        finally:
            self.httpd = None
            self.thread = None

    def url(self, path: str) -> str:
        return f"http://127.0.0.1:{self.port}/{path.lstrip('/')}"
