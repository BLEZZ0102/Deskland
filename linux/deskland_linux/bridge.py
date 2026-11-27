"""WebKitGTK bridge that emulates the WebView2 ``window.chrome.webview`` API.

The prototype pages depend on three things from WebView2:
  * window.chrome.webview.addEventListener('message', fn)
  * window.chrome.webview.postMessage(string)
  * host -> page messages delivered as MessageEvent with a JSON string in .data

A UserScript injected at document-start installs the same surface on WebKitGTK,
backed by WebKit's native script message handler.
"""

from __future__ import annotations

import json
import os
from collections.abc import Callable
from typing import Any

import gi

gi.require_version("Gtk", "3.0")

try:
    gi.require_version("WebKit2", "4.1")
except ValueError:
    gi.require_version("WebKit2", "4.0")

from gi.repository import WebKit2  # noqa: E402

BRIDGE_JS = r"""
(function () {
  if (window.__desklandBridgeInstalled) return;
  window.__desklandBridgeInstalled = true;
  var listeners = [];
  var webview = {
    addEventListener: function (type, fn) {
      if (type === 'message' && typeof fn === 'function') listeners.push(fn);
    },
    removeEventListener: function (type, fn) {
      var i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    postMessage: function (data) {
      window.webkit.messageHandlers.deskland.postMessage(String(data));
    }
  };
  try { window.chrome = window.chrome || {}; } catch (e) {}
  try {
    Object.defineProperty(window.chrome, 'webview', {
      configurable: true, enumerable: true, writable: false, value: webview
    });
  } catch (e) {
    try { window.chrome.webview = webview; } catch (e2) {}
  }
  window.__desklandDeliver = function (data) {
    var event = { data: data, source: window, origin: location.origin };
    listeners.slice().forEach(function (fn) {
      try { fn(event); } catch (err) { console.error('Deskland bridge listener:', err); }
    });
  };
})();
"""


def _js_value_to_string(value: Any) -> str:
    for method in ("to_string", "to_str"):
        fn = getattr(value, method, None)
        if callable(fn):
            try:
                text = fn()
                if isinstance(text, str):
                    return text
            except (TypeError, ValueError):
                pass
    return str(value)


class BridgeWebView:
    def __init__(self, on_message: Callable[[str], None]) -> None:
        self.on_message = on_message
        manager = WebKit2.UserContentManager()
        manager.register_script_message_handler("deskland")
        manager.connect("script-message-received::deskland", self._received)
        script = WebKit2.UserScript.new(
            BRIDGE_JS,
            WebKit2.UserContentInjectedFrames.ALL_FRAMES,
            WebKit2.UserScriptInjectionTime.START,
            None,
            None,
        )
        manager.add_script(script)
        self.webview = WebKit2.WebView.new_with_user_content_manager(manager)
        self._configure()

    def _configure(self) -> None:
        settings = self.webview.get_settings()
        for name, value in (
            ("set_enable_webgl", True),
            ("set_enable_accelerated_2d_canvas", True),
            ("set_enable_html5_local_storage", True),
            ("set_enable_html5_database", True),
            ("set_enable_developer_extras", bool(os.environ.get("DESKLAND_DEBUG"))),
        ):
            fn = getattr(settings, name, None)
            if callable(fn):
                try:
                    fn(value)
                except (TypeError, ValueError):
                    pass
        self.webview.set_settings(settings)

    def _received(self, _manager: Any, result: Any) -> None:
        try:
            value = result.get_js_value() if hasattr(result, "get_js_value") else result
            text = _js_value_to_string(value)
        except (AttributeError, TypeError, ValueError):
            return
        try:
            self.on_message(text)
        except Exception:
            # The GTK main loop must stay alive even if a page sends garbage.
            pass

    def load_uri(self, uri: str) -> None:
        self.webview.load_uri(uri)

    def reload(self) -> None:
        self.webview.reload()

    def post(self, payload: Any) -> None:
        """Deliver a host message. Dict/list are serialised; str is sent verbatim."""
        if isinstance(payload, str):
            data = payload
        else:
            data = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        script = "window.__desklandDeliver(%s);" % json.dumps(data, ensure_ascii=False)
        self._run_js(script)

    def post_json(self, payload: dict[str, Any]) -> None:
        self.post(payload)

    def _run_js(self, script: str) -> None:
        evaluate = getattr(self.webview, "evaluate_javascript", None)
        if callable(evaluate):
            try:
                evaluate(script, -1, None, None, None, None, None)
                return
            except (TypeError, ValueError):
                pass
        run = getattr(self.webview, "run_javascript", None)
        if callable(run):
            try:
                run(script, None, None, None)
            except (TypeError, ValueError):
                pass
