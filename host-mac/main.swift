// Deskland Preview · macOS host (local, unofficial port of host/DesktopHost.cs)
//
// Same job as the Windows host, with macOS pieces:
//   1. A borderless window just above the system wallpaper and below the Finder desktop icons,
//      showing the current theme page (prototype/flat.html?wallpaper=1) in a WKWebView.
//   2. Desktop icon positions come from Finder (Apple Events); only changes are sent to the page.
//   3. Animation pauses when the desktop is covered; a menu bar item pauses, reloads and quits.
//   4. Settings window (prototype/settings.html), saved to settings.json; image / clip sharing.
//
// The pages are not modified: a small script injected at document start provides the
// window.chrome.webview object they expect from WebView2.

import Cocoa
import WebKit
import Carbon.HIToolbox

let appId = "app.deskland.preview.local"
let appName = "Deskland Preview"

// ---------------------------------------------------------------- paths, log

enum Paths {
    static let dataDir: URL = {
        if let o = ProcessInfo.processInfo.environment["DESKLAND_PROFILE_DIR"], !o.isEmpty { return URL(fileURLWithPath: o) }
        return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("DesklandPreview")
    }()
    static let shareDir = FileManager.default.urls(for: .picturesDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("Deskland Preview")
    static let launchAgent = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/LaunchAgents/\(appId).plist")
    static let logFile = dataDir.appendingPathComponent("host.log")
}

let logStamp: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd HH:mm:ss"
    return f
}()
let logQueue = DispatchQueue(label: "deskland.log")

func log(_ msg: String) {
    let line = logStamp.string(from: Date()) + " " + msg + "\n"
    logQueue.async {
        try? FileManager.default.createDirectory(at: Paths.dataDir, withIntermediateDirectories: true)
        if let h = try? FileHandle(forWritingTo: Paths.logFile) {
            h.seekToEndOfFile()
            h.write(line.data(using: .utf8)!)
            try? h.close()
        } else {
            try? line.data(using: .utf8)!.write(to: Paths.logFile)
        }
    }
}

func jsonString(_ o: Any) -> String {
    guard let d = try? JSONSerialization.data(withJSONObject: o, options: [.fragmentsAllowed]) else { return "null" }
    return String(data: d, encoding: .utf8) ?? "null"
}

// ---------------------------------------------------------------- settings, texts, themes

// Current theme plus the parameters the user changed for each theme (settings.json, same shape as on Windows).
enum Settings {
    static let file = Paths.dataDir.appendingPathComponent("settings.json")
    static var theme = "beach"
    static var lang = "auto"
    static var params: [String: [String: Any]] = [:]

    static func load() {
        guard let d = try? Data(contentsOf: file),
              let root = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return }
        if let t = root["theme"] as? String { theme = t }
        if let l = root["lang"] as? String { lang = l }
        if let p = root["params"] as? [String: [String: Any]] { params = p }
        log("settings loaded: theme \(theme)")
    }

    static func save() {
        try? FileManager.default.createDirectory(at: Paths.dataDir, withIntermediateDirectories: true)
        let root: [String: Any] = ["version": 1, "theme": theme, "lang": lang, "params": params]
        do { try JSONSerialization.data(withJSONObject: root).write(to: file, options: .atomic) }
        catch { log("saving settings failed: \(error.localizedDescription)") }
    }
}

// Interface language: prototype/i18n/<code>.json, key "host". A few lines name Windows, so they are replaced here.
enum I18n {
    static let supported = ["zh-CN", "en"]
    static var code = "en", sys = "en"
    static var cur: [String: String] = [:], en: [String: String] = [:]
    static let macTexts: [String: [String: String]] = [
        "en": ["trayAutostart": "Start at login", "trayExit": "Quit Deskland"],
        "zh-CN": ["trayAutostart": "登录时自动启动", "trayExit": "退出"],
    ]

    static func load(_ pageDir: URL, setting: String) {
        let pref = (Locale.preferredLanguages.first ?? "en").lowercased()
        sys = pref.hasPrefix("zh") ? "zh-CN" : "en"
        code = supported.contains(setting) ? setting : sys
        en = read(pageDir, "en")
        cur = code == "en" ? en : read(pageDir, code)
        log("interface language: \(code) (setting: \(setting), system: \(sys))")
    }

    static func read(_ pageDir: URL, _ code: String) -> [String: String] {
        let f = pageDir.appendingPathComponent("i18n/\(code).json")
        guard let d = try? Data(contentsOf: f),
              let root = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
              var host = root["host"] as? [String: String] else { return [:] }
        for (k, v) in macTexts[code] ?? [:] { host[k] = v }
        return host
    }

    static func t(_ key: String, _ vars: [String: String] = [:]) -> String {
        var s = cur[key] ?? en[key] ?? key
        for (k, v) in vars { s = s.replacingOccurrences(of: "{\(k)}", with: v) }
        return s
    }
}

// Theme registry (prototype/themes.json): only ready, free themes with a page can be loaded.
enum Themes {
    static func page(_ pageDir: URL, _ id: String) -> String? {
        guard let d = try? Data(contentsOf: pageDir.appendingPathComponent("themes.json")),
              let root = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
              let list = root["themes"] as? [[String: Any]] else { return nil }
        for th in list where th["id"] as? String == id {
            guard th["status"] as? String == "ready", th["product"] as? String == "free" else { return nil }
            return th["page"] as? String
        }
        return nil
    }
}

// ---------------------------------------------------------------- serving the pages

// deskland://app/…   → prototype/            (the Windows host maps https://app.local/)
// deskland://share/… → ~/Pictures/Deskland Preview/   (https://share.local/)
final class PageServer: NSObject, WKURLSchemeHandler {
    let pageDir: URL
    init(pageDir: URL) { self.pageDir = pageDir }

    static let types: [String: String] = [
        "html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8", "mjs": "text/javascript; charset=utf-8",
        "json": "application/json; charset=utf-8", "css": "text/css; charset=utf-8", "png": "image/png",
        "webp": "image/webp", "svg": "image/svg+xml", "ico": "image/x-icon", "mp4": "video/mp4", "webm": "video/webm",
    ]

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        let root: URL? = url.host == "app" ? pageDir : url.host == "share" ? Paths.shareDir : nil
        let rel = String(url.path.drop(while: { $0 == "/" }))
        guard let root = root, !rel.isEmpty else { return respond(task, url, 404, Data(), [:]) }
        let base = root.standardizedFileURL.path
        let file = root.appendingPathComponent(rel).standardizedFileURL
        guard file.path.hasPrefix(base + "/"), var data = try? Data(contentsOf: file) else {
            return respond(task, url, 404, Data(), [:])
        }
        // The settings page says "Start with Windows"; the file on disk stays as upstream wrote it.
        if rel == "i18n/en.json", let s = String(data: data, encoding: .utf8) {
            data = s.replacingOccurrences(of: "Start with Windows", with: "Start at login").data(using: .utf8)!
        }
        var headers = [
            "Content-Type": PageServer.types[file.pathExtension.lowercased()] ?? "application/octet-stream",
            "Cache-Control": "no-store", "Accept-Ranges": "bytes",
        ]
        // Video elements ask for byte ranges.
        if let range = task.request.value(forHTTPHeaderField: "Range"), range.hasPrefix("bytes="), !data.isEmpty {
            let parts = range.dropFirst(6).split(separator: "-", omittingEmptySubsequences: false)
            let total = data.count
            let start = min(Int(parts.first ?? "") ?? 0, total - 1)
            let end = min(parts.count > 1 ? (Int(parts[1]) ?? total - 1) : total - 1, total - 1)
            if start <= end {
                headers["Content-Range"] = "bytes \(start)-\(end)/\(total)"
                return respond(task, url, 206, data.subdata(in: start..<(end + 1)), headers)
            }
        }
        respond(task, url, 200, data, headers)
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    private func respond(_ task: WKURLSchemeTask, _ url: URL, _ status: Int, _ data: Data, _ headers: [String: String]) {
        var h = headers
        h["Content-Length"] = String(data.count)
        let r = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: h)!
        task.didReceive(r)
        task.didReceive(data)
        task.didFinish()
    }
}

// What the pages use of WebView2: chrome.webview.postMessage / addEventListener('message').
let bridgeShim = """
(function () {
  const listeners = [];
  window.chrome = window.chrome || {};
  window.chrome.webview = {
    postMessage: m => window.webkit.messageHandlers.deskland.postMessage(typeof m === 'string' ? m : JSON.stringify(m)),
    addEventListener: (type, f) => { if (type === 'message') listeners.push(f); },
    removeEventListener: (type, f) => { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); },
  };
  const note = s => window.webkit.messageHandlers.deskland.postMessage('log|' + location.pathname + ': ' + s);
  window.addEventListener('error', e => note((e.message || 'resource failed to load') + (e.filename ? ' @' + e.filename + ':' + e.lineno : '')), true);
  window.addEventListener('unhandledrejection', e => note('rejected: ' + (e.reason && e.reason.message || e.reason)));
  window.__desklandHost = data => { for (const f of listeners.slice()) { try { f({ data }); } catch (e) { console.error(e); } } };
})();
"""

final class MessageRelay: NSObject, WKScriptMessageHandler {
    var onMessage: ((String) -> Void)?
    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let s = message.body as? String else { return }
        if s.hasPrefix("log|") { log("page " + s.dropFirst(4)) } else { onMessage?(s) }
    }
}

func makeWebView(server: PageServer, relay: MessageRelay) -> WKWebView {
    let cfg = WKWebViewConfiguration()
    cfg.setURLSchemeHandler(server, forURLScheme: "deskland")
    cfg.userContentController.add(relay, name: "deskland")
    cfg.userContentController.addUserScript(
        WKUserScript(source: bridgeShim, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    cfg.mediaTypesRequiringUserActionForPlayback = []
    let web = WKWebView(frame: .zero, configuration: cfg)
    if #available(macOS 13.3, *) { web.isInspectable = true }
    return web
}

func post(_ web: WKWebView, _ json: String) {
    web.evaluateJavaScript("window.__desklandHost && window.__desklandHost(\(jsonString(json)))", completionHandler: nil)
}

// ---------------------------------------------------------------- desktop icons (Finder)

// Finder reports each desktop item's position as the centre of its icon, in points from the
// top-left corner of the primary screen. File names are never requested.
final class IconReader {
    struct Result { let rects: [CGRect]; let visible: Bool }
    var onResult: ((Result) -> Void)?
    var onDenied: (() -> Void)?
    private var running = false

    static let source = """
    with timeout of 5 seconds
      tell application "Finder"
        set opts to icon view options of window of desktop
        set s to icon size of opts
        set ts to text size of opts
        set lp to (label position of opts) as text
        try
          set ps to desktop position of every item of desktop
        on error
          set ps to {}
        end try
        return {s, ts, lp, ps}
      end tell
    end timeout
    """

    func start() {
        if running { return }
        running = true
        // NSAppleScript is created and used on this one thread only.
        let t = Thread { [weak self] in
            let script = NSAppleScript(source: IconReader.source)
            var failing = false
            while let me = self, me.running {
                autoreleasepool {
                    var err: NSDictionary?
                    let d = script?.executeAndReturnError(&err)
                    if let err = err {
                        if !failing {
                            failing = true
                            let code = (err[NSAppleScript.errorNumber] as? Int) ?? 0
                            log("reading desktop icons failed (\(code)): \(err[NSAppleScript.errorMessage] ?? "")")
                            if code == -1743 { DispatchQueue.main.async { me.onDenied?() } }
                        }
                    } else if let d = d {
                        failing = false
                        let r = IconReader.parse(d)
                        DispatchQueue.main.async { me.onResult?(r) }
                    }
                }
                Thread.sleep(forTimeInterval: 0.5)
            }
        }
        t.name = "deskland.icons"
        t.qualityOfService = .utility
        t.start()
    }

    static func iconsHidden() -> Bool {
        CFPreferencesAppSynchronize("com.apple.finder" as CFString)
        CFPreferencesAppSynchronize("com.apple.WindowManager" as CFString)
        if let v = CFPreferencesCopyAppValue("CreateDesktop" as CFString, "com.apple.finder" as CFString) {
            if let b = v as? Bool, !b { return true }
            if let s = v as? String, ["false", "0", "no"].contains(s.lowercased()) { return true }
        }
        if let v = CFPreferencesCopyAppValue("StandardHideDesktopIcons" as CFString, "com.apple.WindowManager" as CFString) as? Bool, v {
            return true
        }
        return false
    }

    static func parse(_ d: NSAppleEventDescriptor) -> Result {
        if iconsHidden() { return Result(rects: [], visible: false) }
        let size = CGFloat(d.atIndex(1)?.int32Value ?? 64)
        let text = CGFloat(d.atIndex(2)?.int32Value ?? 12)
        let labelRight = d.atIndex(3)?.stringValue == "right"
        var centres: [CGPoint] = []
        if let ps = d.atIndex(4), ps.descriptorType == typeAEList {
            let n = ps.numberOfItems
            if n == 2, let a = ps.atIndex(1), a.descriptorType != typeAEList, let b = ps.atIndex(2) {
                centres.append(CGPoint(x: Int(a.int32Value), y: Int(b.int32Value)))   // one item: {x, y}
            } else if n > 0 {
                for i in 1...n {
                    guard let p = ps.atIndex(i), p.numberOfItems == 2,
                          let a = p.atIndex(1), let b = p.atIndex(2) else { continue }
                    centres.append(CGPoint(x: Int(a.int32Value), y: Int(b.int32Value)))
                }
            }
        }
        // Icon plus a label area of fixed size (two lines below, or one line to the right).
        let line = (text * 1.3).rounded(.up)
        let rects = centres.map { c -> CGRect in
            let top = c.y - size / 2 - 4
            if labelRight {
                return CGRect(x: c.x - size / 2 - 4, y: top, width: size + 132, height: size + 8)
            }
            let w = size + 44
            return CGRect(x: c.x - w / 2, y: top, width: w, height: size + 10 + 2 * line)
        }
        return Result(rects: rects, visible: true)
    }
}

// ---------------------------------------------------------------- wallpaper window

final class Wallpaper: NSObject, WKNavigationDelegate {
    let window: NSWindow
    let web: WKWebView
    let relay = MessageRelay()
    let pageDir: URL
    var page: String
    var settingsJson: (() -> String)?
    var onIcons: ((String) -> Void)?
    var onRecordProgress: ((String) -> Void)?
    private(set) var lastIcons = ""
    private var lastPause = -1
    private var latest: IconReader.Result?
    var manualPause = false { didSet { pollPause() } }
    private var pauseTimer: Timer?

    var screen: NSScreen { NSScreen.screens.first ?? NSScreen.main! }   // the primary screen (menu bar, origin 0,0)

    init(server: PageServer, pageDir: URL, page: String) {
        self.pageDir = pageDir
        self.page = page
        web = makeWebView(server: server, relay: relay)
        let frame = (NSScreen.screens.first ?? NSScreen.main!).frame
        window = NSWindow(contentRect: frame, styleMask: .borderless, backing: .buffered, defer: false)
        super.init()
        // One step above the system wallpaper; Finder's desktop icons sit higher (kCGDesktopIconWindowLevel).
        window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)) + 1)
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        window.ignoresMouseEvents = true
        window.hasShadow = false
        window.isOpaque = true
        window.isReleasedWhenClosed = false
        window.backgroundColor = NSColor(srgbRed: 26 / 255, green: 163 / 255, blue: 196 / 255, alpha: 1)
        window.contentView = web
        web.navigationDelegate = self
        relay.onMessage = { [weak self] m in self?.onMessage(m) }
        NotificationCenter.default.addObserver(self, selector: #selector(screensChanged),
            name: NSApplication.didChangeScreenParametersNotification, object: nil)
    }

    var pageURL: URL { URL(string: "deskland://app/\(page)?wallpaper=1")! }

    func show() {
        window.setFrame(screen.frame, display: true)
        window.orderFrontRegardless()
        web.load(URLRequest(url: pageURL))
        pauseTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in self?.pollPause() }
        log("wallpaper attached, screen \(Int(screen.frame.width))x\(Int(screen.frame.height)) pt @\(screen.backingScaleFactor)x")
    }

    func close() {
        pauseTimer?.invalidate()
        window.orderOut(nil)
    }

    func loadPage(_ newPage: String) { page = newPage; web.load(URLRequest(url: pageURL)) }
    func reload() { web.load(URLRequest(url: pageURL)) }
    func send(_ json: String) { post(web, json) }

    @objc func screensChanged() {
        window.setFrame(screen.frame, display: true)
        if let r = latest { lastIcons = ""; icons(r) }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        log("web content process ended, reloading the wallpaper page")
        reload()
    }

    // The page says "ready": settings first, then icons and the pause state (same order as on Windows).
    private func onMessage(_ msg: String) {
        if msg.hasPrefix("snapshot|") { onSnapshot(msg); return }
        if msg.hasPrefix("recprogress|") { onRecordProgress?(String(msg.dropFirst(12))); return }
        if msg.hasPrefix("record|") { onRecord(msg); return }
        if let s = settingsJson?() { send(s) }
        lastIcons = ""; lastPause = -1
        if let r = latest { icons(r) }
        pollPause()
        // One line in the log a few seconds later: is the page drawing?
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
            let js = "[typeof frameN === 'number' ? frameN : -1, document.querySelectorAll('canvas').length, innerWidth, innerHeight, devicePixelRatio].join(' ')"
            self?.web.evaluateJavaScript(js) { v, e in
                log("page check (frames canvases width height scale): \(v ?? e?.localizedDescription ?? "?")")
            }
        }
    }

    // Icon rectangles: physical pixels relative to the primary screen, as the pages expect.
    // Desktop widgets: each one is a window of Notification Centre at a desktop level. Its bounds
    // (points from the top-left of the primary screen) include about 8 pt of padding on every side.
    static func widgetRects() -> [CGRect] {
        guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] else { return [] }
        var pids: [Int32: Bool] = [:]
        return list.compactMap { w -> CGRect? in
            guard let layer = w[kCGWindowLayer as String] as? Int, layer < 0,
                  let pid = w[kCGWindowOwnerPID as String] as? Int32,
                  let b = w[kCGWindowBounds as String] as? NSDictionary,
                  let rect = CGRect(dictionaryRepresentation: b), rect.width > 40, rect.height > 40 else { return nil }
            if pids[pid] == nil {
                pids[pid] = NSRunningApplication(processIdentifier: pid)?.bundleIdentifier == "com.apple.notificationcenterui"
            }
            return pids[pid] == true ? rect.insetBy(dx: 8, dy: 8) : nil
        }
    }

    func icons(_ r: IconReader.Result) {
        latest = r
        let k = screen.backingScaleFactor
        let bounds = CGRect(origin: .zero, size: screen.frame.size)
        let all = r.visible ? r.rects + Wallpaper.widgetRects() : r.rects
        let parts = all.filter { $0.intersects(bounds) }.map { q -> String in
            "[\(Int((q.minX * k).rounded())),\(Int((q.minY * k).rounded())),\(Int((q.maxX * k).rounded())),\(Int((q.maxY * k).rounded()))]"
        }
        let json = "{\"t\":\"icons\",\"vis\":\(r.visible ? "true" : "false"),\"r\":[\(parts.joined(separator: ","))]}"
        if json == lastIcons { return }
        lastIcons = json
        onIcons?(json)
        send(json)
        log("icons changed: \(parts.count), visible=\(r.visible)")
    }

    // Pause when nothing of the wallpaper is visible, or the front app has a window filling the screen.
    private func coveredByFrontWindow() -> Bool {
        guard let front = NSWorkspace.shared.frontmostApplication,
              front.processIdentifier != getpid(), front.bundleIdentifier != "com.apple.finder",
              let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
                as? [[String: Any]] else { return false }
        let f = screen.frame, v = screen.visibleFrame
        let usable = CGRect(x: v.minX - f.minX, y: f.maxY - v.maxY, width: v.width, height: v.height).insetBy(dx: 3, dy: 3)
        for w in list {
            guard (w[kCGWindowOwnerPID as String] as? Int32) == front.processIdentifier,
                  (w[kCGWindowLayer as String] as? Int) == 0,
                  let b = w[kCGWindowBounds as String] as? NSDictionary,
                  let rect = CGRect(dictionaryRepresentation: b) else { continue }
            if rect.contains(usable) { return true }
        }
        return false
    }

    func pollPause() {
        let pause = manualPause || !window.occlusionState.contains(.visible) || coveredByFrontWindow()
        let p = pause ? 1 : 0
        if p == lastPause { return }
        lastPause = p
        send("{\"t\":\"pause\",\"v\":\(pause ? "true" : "false")}")
        log(pause ? "paused (desktop covered, or paused by hand)" : "resumed")
    }

    // ---- sharing: the page draws the picture / records the clip itself, from icon positions only ----
    private var snapshotDone: ((String?, String?, String?) -> Void)?    // (thumbnail, PNG, error)
    private var snapshotTimeout: DispatchWorkItem?
    func requestSnapshot(_ done: @escaping (String?, String?, String?) -> Void) {
        if snapshotDone != nil { done(nil, nil, I18n.t("errBusyImage")); return }
        snapshotDone = done
        let w = DispatchWorkItem { [weak self] in self?.finishSnapshot(nil, nil, I18n.t("errImageTimeout")) }
        snapshotTimeout = w
        DispatchQueue.main.asyncAfter(deadline: .now() + 20, execute: w)
        send("{\"t\":\"snapshot\"}")
    }
    private func onSnapshot(_ msg: String) {
        let p = msg.split(separator: "|", maxSplits: 2, omittingEmptySubsequences: false).map(String.init)
        if p.count < 3 { finishSnapshot(nil, nil, I18n.t("errBadData")) }
        else if p[1] == "error" { finishSnapshot(nil, nil, p[2]) }
        else { finishSnapshot(p[1], p[2], nil) }
    }
    private func finishSnapshot(_ thumb: String?, _ png: String?, _ err: String?) {
        snapshotTimeout?.cancel(); snapshotTimeout = nil
        let done = snapshotDone
        snapshotDone = nil
        done?(thumb, png, err)
    }

    private var recordDone: ((String?, String?, String?, String?) -> Void)?   // (mime, poster, clip, error)
    private var recordTimeout: DispatchWorkItem?
    func requestRecording(_ done: @escaping (String?, String?, String?, String?) -> Void) {
        if recordDone != nil { done(nil, nil, nil, I18n.t("errBusyVideo")); return }
        recordDone = done
        let w = DispatchWorkItem { [weak self] in self?.finishRecord(nil, nil, nil, I18n.t("errVideoTimeout")) }
        recordTimeout = w
        DispatchQueue.main.asyncAfter(deadline: .now() + 45, execute: w)
        send("{\"t\":\"record\"}")
    }
    private func onRecord(_ msg: String) {
        let p = msg.split(separator: "|", maxSplits: 3, omittingEmptySubsequences: false).map(String.init)
        if p.count >= 3, p[1] == "error" { finishRecord(nil, nil, nil, String(msg.dropFirst(13))) }
        else if p.count < 4 { finishRecord(nil, nil, nil, I18n.t("errBadData")) }
        else { finishRecord(p[1], p[2], p[3], nil) }
    }
    private func finishRecord(_ mime: String?, _ poster: String?, _ video: String?, _ err: String?) {
        recordTimeout?.cancel(); recordTimeout = nil
        let done = recordDone
        recordDone = nil
        done?(mime, poster, video, err)
    }
}

// ---------------------------------------------------------------- settings window

final class SettingsWindow: NSObject, NSWindowDelegate, WKUIDelegate {
    let window: NSWindow
    let web: WKWebView
    let relay = MessageRelay()
    var onClose: (() -> Void)?

    init(server: PageServer, version: String, onMessage: @escaping (String) -> Void) {
        web = makeWebView(server: server, relay: relay)
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1120, height: 800),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        super.init()
        window.title = appName
        window.contentMinSize = NSSize(width: 940, height: 680)
        window.isReleasedWhenClosed = false
        window.contentView = web
        window.center()
        window.delegate = self
        web.uiDelegate = self
        relay.onMessage = onMessage
        let v = version.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? version
        web.load(URLRequest(url: URL(string: "deskland://app/settings.html?v=\(v)")!))
    }

    func show() {
        if window.isMiniaturized { window.deminiaturize(nil) }
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    func send(_ json: String) { post(web, json) }

    func windowWillClose(_ notification: Notification) {
        web.configuration.userContentController.removeScriptMessageHandler(forName: "deskland")
        onClose?()
    }

    // settings.html reports sharing failures with alert()
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert()
        a.messageText = appName
        a.informativeText = message
        a.beginSheetModal(for: window) { _ in completionHandler() }
    }
}

// ---------------------------------------------------------------- application

final class App: NSObject, NSApplicationDelegate, NSMenuDelegate {
    let pageDir: URL
    let openSettingsAtStart: Bool
    let version: String
    var server: PageServer!
    var wallpaper: Wallpaper?
    var settingsWin: SettingsWindow?
    let reader = IconReader()
    var statusItem: NSStatusItem!
    let menu = NSMenu()
    var settingsItem, pauseItem, reloadItem, autoStartItem, exitItem: NSMenuItem!
    var manualPause = false
    var saveWork: DispatchWorkItem?
    var lastShare: URL?
    var hotKey: EventHotKeyRef?
    var deniedShown = false

    init(pageDir: URL, openSettings: Bool) {
        self.pageDir = pageDir
        self.openSettingsAtStart = openSettings
        version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
    }

    func applicationDidFinishLaunching(_ n: Notification) {
        log("start, pages: \(pageDir.path)" + (openSettingsAtStart ? "" : " (login start)"))
        Settings.load()
        I18n.load(pageDir, setting: Settings.lang)
        server = PageServer(pageDir: pageDir)
        buildMenus()
        log(registerHotkey() ? "hotkey Ctrl+Option+H registered" : "hotkey Ctrl+Option+H could not be registered")

        let dn = DistributedNotificationCenter.default()
        dn.addObserver(self, selector: #selector(quit), name: .init(appId + ".exit"), object: nil)
        dn.addObserver(self, selector: #selector(openSettings), name: .init(appId + ".settings"), object: nil)
        dn.addObserver(self, selector: #selector(showMenu), name: .init(appId + ".menu"), object: nil)

        startWallpaper()
        reader.onResult = { [weak self] r in self?.wallpaper?.icons(r) }
        reader.onDenied = { [weak self] in self?.showDenied() }
        reader.start()
        if openSettingsAtStart { openSettings() }
    }

    // Opening the app again (Finder, `open`) shows Settings.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        openSettings()
        return false
    }

    func applicationWillTerminate(_ n: Notification) {
        if saveWork != nil { Settings.save() }
        log("exit")
    }

    // ---- menu bar item, main menu, hotkey
    func buildMenus() {
        func item(_ key: String, _ action: Selector) -> NSMenuItem {
            let i = NSMenuItem(title: I18n.t(key), action: action, keyEquivalent: "")
            i.target = self
            menu.addItem(i)
            return i
        }
        settingsItem = item("traySettings", #selector(openSettings))
        pauseItem = item("trayPause", #selector(togglePause))
        reloadItem = item("trayReload", #selector(reloadPage))
        autoStartItem = item("trayAutostart", #selector(toggleAutoStart))
        menu.addItem(.separator())
        exitItem = item("trayExit", #selector(quit))
        menu.delegate = self

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let u = Bundle.main.url(forResource: "DesklandPreview", withExtension: "ico") ?? Optional(pageDir.appendingPathComponent("../host/DesklandPreview.ico")),
           let img = NSImage(contentsOf: u) {
            img.size = NSSize(width: 18, height: 18)
            statusItem.button?.image = img
            NSApp.applicationIconImage = NSImage(contentsOf: u)
        } else {
            statusItem.button?.title = "D"
        }
        statusItem.button?.toolTip = appName
        statusItem.menu = menu

        // Main menu: gives the settings window the usual shortcuts (copy, paste, close, quit).
        let main = NSMenu()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: I18n.t("trayExit"), action: #selector(quit), keyEquivalent: "q").target = self
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        let win = NSMenu(title: "Window")
        win.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        win.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        for m in [appMenu, edit, win] {
            let holder = NSMenuItem()
            holder.submenu = m
            main.addItem(holder)
        }
        NSApp.mainMenu = main
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        pauseItem.state = manualPause ? .on : .off
        autoStartItem.state = isAutoStart ? .on : .off
    }

    func applyTrayTexts() {
        settingsItem.title = I18n.t("traySettings")
        pauseItem.title = I18n.t("trayPause")
        reloadItem.title = I18n.t("trayReload")
        autoStartItem.title = I18n.t("trayAutostart")
        exitItem.title = I18n.t("trayExit")
    }

    func registerHotkey() -> Bool {
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, _, _ in
            DispatchQueue.main.async { (NSApp.delegate as? App)?.showMenu() }
            return noErr
        }, 1, &spec, nil, nil)
        let id = EventHotKeyID(signature: OSType(0x4445_534B), id: 1)
        return RegisterEventHotKey(UInt32(kVK_ANSI_H), UInt32(controlKey | optionKey), id,
                                   GetApplicationEventTarget(), 0, &hotKey) == noErr
    }

    @objc func showMenu() { menu.popUp(positioning: nil, at: NSEvent.mouseLocation, in: nil) }
    @objc func togglePause() { manualPause.toggle(); wallpaper?.manualPause = manualPause }
    @objc func reloadPage() { wallpaper?.reload() }
    @objc func toggleAutoStart() { setAutoStart(!isAutoStart) }
    @objc func quit() {
        settingsWin?.window.close()
        wallpaper?.close()
        NSApp.terminate(nil)
    }

    func showDenied() {
        if deniedShown { return }
        deniedShown = true
        let a = NSAlert()
        a.messageText = appName
        a.informativeText = "Deskland can't read the positions of your desktop icons because it isn't allowed to control Finder.\n\nSystem Settings → Privacy & Security → Automation → \(appName) → turn on Finder."
        a.addButton(withTitle: "Open Privacy Settings")
        a.addButton(withTitle: "Later")
        NSApp.activate(ignoringOtherApps: true)
        if a.runModal() == .alertFirstButtonReturn,
           let u = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation") {
            NSWorkspace.shared.open(u)
        }
    }

    // ---- wallpaper
    func themeAllowed(_ id: String) -> Bool { Themes.page(pageDir, id) != nil }

    func startWallpaper() {
        if !themeAllowed(Settings.theme) { Settings.theme = themeAllowed("beach") ? "beach" : "meadow" }
        guard let page = Themes.page(pageDir, Settings.theme) else {
            fail(I18n.t("errNoPage", ["path": pageDir.appendingPathComponent("themes.json").path]))
            return
        }
        let w = Wallpaper(server: server, pageDir: pageDir, page: page)
        w.manualPause = manualPause
        w.settingsJson = { jsonString(["t": "settings", "v": Settings.params[Settings.theme] ?? [:]] as [String: Any]) }
        w.onIcons = { [weak self] json in self?.settingsWin?.send(json) }
        w.onRecordProgress = { [weak self] p in self?.settingsWin?.send("{\"t\":\"recProgress\",\"p\":\(Double(p) ?? 0)}") }
        wallpaper = w
        w.show()
    }

    func fail(_ msg: String) {
        log(msg)
        let a = NSAlert()
        a.messageText = appName
        a.informativeText = msg + "\n\n" + I18n.t("errSeeLog", ["path": Paths.logFile.path])
        NSApp.activate(ignoringOtherApps: true)
        a.runModal()
        NSApp.terminate(nil)
    }

    // ---- settings
    @objc func openSettings() {
        if settingsWin == nil {
            let s = SettingsWindow(server: server, version: version) { [weak self] m in self?.onSettingsMessage(m) }
            s.onClose = { [weak self] in self?.settingsWin = nil }
            settingsWin = s
            log("settings window opened")
        }
        settingsWin?.show()
    }

    func saveSoon() {
        saveWork?.cancel()
        let w = DispatchWorkItem { [weak self] in Settings.save(); self?.saveWork = nil }
        saveWork = w
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6, execute: w)
    }

    // Messages from the settings page: hello / set / reset / theme / lang / autostart / share…
    func onSettingsMessage(_ s: String) {
        guard let d = s.data(using: .utf8), let m = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
              let win = settingsWin else { return }
        switch m["t"] as? String {
        case "hello":
            let scr = NSScreen.screens.first ?? NSScreen.main!
            let k = scr.backingScaleFactor
            win.send(jsonString([
                "t": "init", "theme": Settings.theme, "params": Settings.params,
                "screen": ["w": Int(scr.frame.width * k), "h": Int(scr.frame.height * k)],
                "autostart": isAutoStart, "autostartWarn": false, "autostartSw": "",
                "lang": Settings.lang, "langEff": I18n.code, "langSys": I18n.sys,
            ] as [String: Any]))
            if let w = wallpaper, !w.lastIcons.isEmpty { win.send(w.lastIcons) }
        case "set":
            guard let theme = m["theme"] as? String, let key = m["key"] as? String, let value = m["value"] else { return }
            Settings.params[theme, default: [:]][key] = value
            if theme == Settings.theme { wallpaper?.send(jsonString(["t": "settings", "v": [key: value]] as [String: Any])) }
            saveSoon()
        case "reset":
            guard let theme = m["theme"] as? String else { return }
            Settings.params.removeValue(forKey: theme)
            if theme == Settings.theme { wallpaper?.send("{\"t\":\"reset\"}") }
            saveSoon()
            log("defaults restored: \(theme)")
        case "theme":
            guard let id = m["id"] as? String, let page = Themes.page(pageDir, id) else {
                win.send(jsonString(["t": "themeChanged", "id": Settings.theme]))
                log("theme switch refused: \(m["id"] ?? "null")")
                return
            }
            if id == Settings.theme { return }
            Settings.theme = id
            saveSoon()
            wallpaper?.loadPage(page)
            log("theme: \(id)")
        case "lang":
            guard let v = m["v"] as? String else { return }
            Settings.lang = v
            saveSoon()
            I18n.load(pageDir, setting: v)
            applyTrayTexts()
            win.send(jsonString(["t": "lang", "v": v, "eff": I18n.code, "sys": I18n.sys]))
        case "share":
            guard let w = wallpaper else { postShare(false, I18n.t("errNotReady")); return }
            w.requestSnapshot { [weak self] thumb, png, err in self?.onShareImage(thumb, png, err) }
        case "shareVideo":
            guard let w = wallpaper else { postShare(false, I18n.t("errNotReady")); return }
            w.requestRecording { [weak self] mime, poster, video, err in self?.onShareVideo(mime, poster, video, err) }
        case "openShare":
            if let u = lastShare, FileManager.default.fileExists(atPath: u.path) { NSWorkspace.shared.open(u) }
        case "revealShare":
            if let u = lastShare, FileManager.default.fileExists(atPath: u.path) { NSWorkspace.shared.activateFileViewerSelecting([u]) }
        case "openWebsite":
            NSWorkspace.shared.open(URL(string: "https://deskland.app/")!)
        case "autostart":
            setAutoStart(m["v"] as? Bool ?? false)
            win.send(jsonString(["t": "autostart", "v": isAutoStart]))
        default:
            break
        }
    }

    // ---- sharing: save to ~/Pictures/Deskland Preview, copy to the clipboard, send the preview back
    func postShare(_ ok: Bool, _ msg: String) {
        settingsWin?.send(jsonString(["t": "shareResult", "ok": ok, "msg": msg]))
    }

    func shareFile(_ dataUrl: String, _ ext: String) throws -> (URL, Data) {
        let b64 = dataUrl.firstIndex(of: ",").map { String(dataUrl[dataUrl.index(after: $0)...]) } ?? dataUrl
        guard let bytes = Data(base64Encoded: b64, options: .ignoreUnknownCharacters) else {
            throw NSError(domain: appId, code: 1, userInfo: [NSLocalizedDescriptionKey: I18n.t("errBadData")])
        }
        try FileManager.default.createDirectory(at: Paths.shareDir, withIntermediateDirectories: true)
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd HHmmss"
        let url = Paths.shareDir.appendingPathComponent("Deskland \(f.string(from: Date())).\(ext)")
        try bytes.write(to: url)
        lastShare = url
        return (url, bytes)
    }

    func onShareImage(_ thumb: String?, _ png: String?, _ err: String?) {
        guard err == nil, let png = png else {
            log("share image failed: \(err ?? "")")
            postShare(false, err ?? I18n.t("errNoImage"))
            return
        }
        do {
            let (url, bytes) = try shareFile(png, "png")
            if let img = NSImage(data: bytes) {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.writeObjects([img])
            }
            log("share image: \(url.path)")
            settingsWin?.send(jsonString(["t": "shareResult", "ok": true, "thumb": thumb ?? "", "path": url.path] as [String: Any]))
        } catch {
            log("saving share image failed: \(error.localizedDescription)")
            postShare(false, error.localizedDescription)
        }
    }

    func onShareVideo(_ mime: String?, _ poster: String?, _ video: String?, _ err: String?) {
        guard err == nil, let video = video else {
            log("share clip failed: \(err ?? "")")
            settingsWin?.send(jsonString(["t": "shareResult", "ok": false, "kind": "video", "msg": err ?? I18n.t("errNoVideo")] as [String: Any]))
            return
        }
        do {
            let (url, bytes) = try shareFile(video, mime == "video/webm" ? "webm" : "mp4")
            NSPasteboard.general.clearContents()
            NSPasteboard.general.writeObjects([url as NSURL])
            log("share clip: \(url.path) (\(bytes.count / 1024) KB)")
            let name = url.lastPathComponent.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? url.lastPathComponent
            settingsWin?.send(jsonString(["t": "shareResult", "ok": true, "kind": "video", "thumb": poster ?? "",
                                          "path": url.path, "url": "deskland://share/\(name)"] as [String: Any]))
        } catch {
            log("saving share clip failed: \(error.localizedDescription)")
            settingsWin?.send(jsonString(["t": "shareResult", "ok": false, "kind": "video", "msg": error.localizedDescription] as [String: Any]))
        }
    }

    // ---- start at login: a LaunchAgent for this user that runs this executable with --autostart
    var executablePath: String { Bundle.main.executablePath ?? CommandLine.arguments[0] }

    var isAutoStart: Bool {
        guard let d = NSDictionary(contentsOf: Paths.launchAgent), let a = d["ProgramArguments"] as? [String] else { return false }
        return a.first == executablePath
    }

    func setAutoStart(_ on: Bool) {
        if ProcessInfo.processInfo.environment["DESKLAND_PROFILE_DIR"] != nil { return }   // isolated test profile
        do {
            if on {
                try FileManager.default.createDirectory(at: Paths.launchAgent.deletingLastPathComponent(), withIntermediateDirectories: true)
                let plist: [String: Any] = ["Label": appId, "ProgramArguments": [executablePath, "--autostart"],
                                            "RunAtLoad": true, "ProcessType": "Interactive"]
                try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0).write(to: Paths.launchAgent)
                log("start at login on: \(Paths.launchAgent.path)")
            } else if FileManager.default.fileExists(atPath: Paths.launchAgent.path) {
                try FileManager.default.removeItem(at: Paths.launchAgent)
                log("start at login off")
            }
        } catch { log("changing start at login failed: \(error.localizedDescription)") }
    }
}

// ---------------------------------------------------------------- entry point

// Deskland --exit / --menu / --settings talk to the running instance; --autostart starts without Settings.
func signalRunning(_ name: String) {
    DistributedNotificationCenter.default().postNotificationName(.init(appId + "." + name), object: nil,
                                                                 userInfo: nil, deliverImmediately: true)
    usleep(200_000)
}

func findPages(_ arg: String?) -> URL? {
    let fm = FileManager.default
    func ok(_ u: URL) -> Bool { fm.fileExists(atPath: u.appendingPathComponent("themes.json").path) }
    if let a = arg { let u = URL(fileURLWithPath: a); return ok(u) ? u : nil }
    if let r = Bundle.main.resourceURL?.appendingPathComponent("prototype"), ok(r) { return r }
    var dir = Bundle.main.bundleURL.standardizedFileURL
    for _ in 0..<6 {                                   // built inside the repository: …/host-mac/build/<app>
        dir = dir.deletingLastPathComponent()
        let u = dir.appendingPathComponent("prototype")
        if ok(u) { return u }
    }
    return nil
}

let args = Array(CommandLine.arguments.dropFirst())
for cmd in ["exit", "menu", "settings"] where args.first == "--" + cmd {
    signalRunning(cmd)
    exit(0)
}
let fromAutostart = args.contains("--autostart")

try? FileManager.default.createDirectory(at: Paths.dataDir, withIntermediateDirectories: true)
let lockFd = open(Paths.dataDir.appendingPathComponent("instance.lock").path, O_CREAT | O_RDWR, 0o644)
if lockFd < 0 || flock(lockFd, LOCK_EX | LOCK_NB) != 0 {
    if !fromAutostart { signalRunning("settings") }    // already running: opening it again shows Settings
    exit(0)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
guard let pages = findPages(args.first(where: { !$0.hasPrefix("-") })) else {
    let a = NSAlert()
    a.messageText = appName
    a.informativeText = "The theme pages (prototype/themes.json) were not found. Keep the app inside the repository, build it with --standalone, or pass the folder as an argument."
    a.runModal()
    exit(1)
}
let delegate = App(pageDir: pages.standardizedFileURL, openSettings: !fromAutostart)
app.delegate = delegate
app.run()
