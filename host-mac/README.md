# Deskland Preview · macOS host (local, unofficial)

Swift port of `host/DesktopHost.cs`. It shows the same theme pages from `prototype/` in a window
placed above the system wallpaper and below the Finder desktop icons. The pages are unchanged.

## Build and run

Needs the Xcode Command Line Tools (`swiftc`); Xcode itself is not required.

```bash
host-mac/build.sh
open "host-mac/build/Deskland Preview.app"
```

The app reads the pages from `../prototype`, so keep it inside the repository, or build with
`host-mac/build.sh --standalone` to copy the pages into the app.

The first run asks for permission to control Finder: that is how icon positions are read.

| Argument | Effect |
| --- | --- |
| none | start the wallpaper and open Settings; if already running, open Settings |
| `--autostart` | start without opening Settings |
| `--settings`, `--menu`, `--exit` | tell the running instance to open Settings, show its menu, or quit |

```bash
"host-mac/build/Deskland Preview.app/Contents/MacOS/Deskland" --exit
```

## How it differs from the Windows host

- Window level `kCGDesktopWindowLevel + 1`, on all Spaces; mouse clicks pass through to Finder.
- Icon positions come from Finder through Apple Events every 0.5 s. Finder gives the centre of each
  icon; the label area is a fixed-size estimate, because file names are not read.
- Desktop widgets count too: each is a Notification Centre window whose bounds come from the window
  list (no extra permission), sent to the page as one more rectangle.
- Pages load from `deskland://app/…` and get a small `window.chrome.webview` object in place of WebView2.
- Pauses when the wallpaper window is fully covered or the front app has a window filling the screen.
- Menu bar item in place of the tray icon; Ctrl+Option+H shows the menu at the pointer.
- Start at login writes `~/Library/LaunchAgents/app.deskland.preview.local.plist`.
- Settings and log: `~/Library/Application Support/DesklandPreview/`. Shared files: `~/Pictures/Deskland Preview/`.
- Primary screen only, as on Windows.
