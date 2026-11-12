// Deskland Mac host: the bridge between the theme pages and this app.
// Copyright (C) 2026 Jeremy Day. Part of the Mac host for Deskland (BLEZZ0102/Deskland).
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU General Public License as published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version. See LICENSE at the top of the repository.
//
// The theme pages were written for the Windows host, where WebView2 gives every page
// window.chrome.webview (addEventListener / postMessage). WKWebView has no such object, so a small
// script injected at document start provides one with the same shape. The pages run unchanged.

import WebKit

enum Shim {
  /// Name of the WKScriptMessageHandler the shim posts to.
  static let handler = "deskland"

  /// The injected script. Kept small: it only stores listeners, forwards postMessage and reports
  /// JavaScript errors so the self-test (and the log) can see them.
  static let source = """
    (() => {
      'use strict';
      const native = window.webkit.messageHandlers.\(handler);
      // Listeners the page registered with chrome.webview.addEventListener('message', fn).
      const listeners = new Set();
      // What the page sees: the same surface as WebView2's window.chrome.webview.
      const webview = {
        addEventListener(type, fn) { if (type === 'message' && typeof fn === 'function') listeners.add(fn); },
        removeEventListener(type, fn) { if (type === 'message') listeners.delete(fn); },
        // Page to host: strings go as they are (WebView2's postMessage takes a string or JSON).
        postMessage(msg) { native.postMessage({ kind: 'message', data: typeof msg === 'string' ? msg : JSON.stringify(msg) }); },
      };
      window.chrome = Object.assign(window.chrome || {}, { webview });
      // Host to page: Swift calls this with the JSON text; listeners get { data: "<json string>" }
      // as WebView2's PostWebMessageAsString would give them.
      window.__desklandDeliver = (text) => {
        for (const fn of [...listeners]) {
          try { fn({ data: text }); } catch (e) { report('listener: ' + (e && e.stack || e)); }
        }
        return listeners.size;
      };
      // Errors go to the host: uncaught ones, rejected promises and console.error.
      const report = (text) => native.postMessage({ kind: 'error', data: String(text) });
      addEventListener('error', (e) => report(`${e.message} at ${e.filename}:${e.lineno}:${e.colno}`));
      addEventListener('unhandledrejection', (e) => report('unhandled rejection: ' + (e.reason && e.reason.stack || e.reason)));
      const consoleError = console.error;
      console.error = (...parts) => { report('console.error: ' + parts.join(' ')); consoleError.apply(console, parts); };
    })();
    """

  static var userScript: WKUserScript {
    WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
  }

  /// The JavaScript that hands one message to the page's listeners. The text is passed as a JSON
  /// string literal, so any message is safe to embed.
  static func deliver(_ json: String) -> String {
    let data = try! JSONSerialization.data(withJSONObject: [json], options: [])
    let literal = String(decoding: data, as: UTF8.self).dropFirst().dropLast()
    return "window.__desklandDeliver && window.__desklandDeliver(\(literal))"
  }
}

/// Receives what the shim posts and passes it on. A separate object, so the web view's user
/// content controller (which keeps its handlers strongly) does not keep the page owner alive.
final class ShimHandler: NSObject, WKScriptMessageHandler {
  var onMessage: (String) -> Void = { _ in }
  var onError: (String) -> Void = { _ in }

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let body = message.body as? [String: Any], let kind = body["kind"] as? String else { return }
    let data = body["data"] as? String ?? ""
    if kind == "error" { onError(data) } else { onMessage(data) }
  }
}
