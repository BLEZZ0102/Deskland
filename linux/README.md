# Deskland Preview — Linux port

Linux host for the Deskland Preview prototype. The theme pages, theme registry,
i18n files and sharing code are reused unchanged. The Windows-only C# host is
replaced by a Python/GTK3 process that maps every host responsibility onto
Linux facilities.

> Status: source-complete port, unit-checked on the pure-Python modules.
> It has not been executed on a Linux desktop from this Windows workspace.
> Run the test matrix below on real X11/Wayland sessions before shipping.

## 1. Component mapping

| Windows host | Linux implementation | File |
| --- | --- | --- |
| .NET / WinForms / WebView2 | Python 3.10+, GTK3, WebKit2GTK 4.0/4.1 | `deskland_linux/app.py`, `bridge.py` |
| WebView2 `window.chrome.webview` | UserScript shim over `window.webkit.messageHandlers` | `bridge.py` |
| Desktop ListView cross-process messages | GVfs metadata (`gio info`), Xfce RC, Plasma config | `icons.py` |
| Progman/WorkerW wallpaper attachment | X11 `_NET_WM_WINDOW_TYPE_DESKTOP` window or wlr-layer-shell background layer | `wallpaper.py` |
| WebView2 virtual host mapping | Loopback HTTP server on `127.0.0.1:<random>` | `server.py` |
| `%LOCALAPPDATA%\DesklandPreview` | `$XDG_CONFIG_HOME/deskland` (`~/.config/deskland`) | `config.py` |
| Registry `Run` / Startup folder | `$XDG_CONFIG_HOME/autostart/deskland.desktop` | `autostart.py` |
| `NotifyIcon` tray | Ayatana AppIndicator3, StatusIcon fallback | `tray.py` |
| Clipboard image / file list | GTK clipboard (`set_image`, `set_uris`) | `share.py` |
| Fullscreen detection via `GetForegroundWindow` | xdotool/xprop (X11), swaymsg, Hyprland IPC | `pause.py` |
| NSIS installer | `.deb` builder; Flatpak/AppImage notes below | `packaging/build-deb.sh` |

The prototype expects rectangles in physical pixels and converts them with
`window.devicePixelRatio`. All icon adapters therefore multiply logical GTK/GVfs
coordinates by the monitor scale factor. Set `DESKLAND_ICON_POS_PHYSICAL=1` if a
file manager stores physical pixels.

## 2. Architecture

```
linux/
├─ run.sh                     source launcher
├─ deskland_linux/
│  ├─ __main__.py             python3 -m deskland_linux
│  ├─ app.py                  Gtk.Application, protocol, share, quit
│  ├─ config.py               XDG paths, settings.json, log, i18n, themes
│  ├─ server.py               loopback static server + /__share/
│  ├─ bridge.py               WebKitGTK <-> prototype message bridge
│  ├─ icons.py                GVfs / Xfce / Plasma / grid adapters
│  ├─ pause.py                fullscreen / maximized detection
│  ├─ wallpaper.py            X11 layer, layer-shell, static fallback
│  ├─ static_wallpaper.py     GNOME/KDE/Xfce/Cinnamon/MATE/feh setter
│  ├─ settings_window.py      WebKit settings window
│  ├─ tray.py                 AppIndicator + menu
│  ├─ autostart.py            XDG autostart entry
│  └─ share.py                PNG/WebM export, clipboard, file manager
├─ packaging/                 desktop entry, icon, .deb builder
└─ tests/                     pure-Python unit tests
```

### Message contract (unchanged)

Host → wallpaper: `settings`, `reset`, `icons` (`{t,vis,r:[[l,t,r,b],…]}`),
`pause`, `snapshot`, `record`.

Wallpaper → host: `ready`, `snapshot|<thumb>|<png>`,
`recprogress|<0..1>`, `record|<mime>|<poster>|<video>`.

Settings → host: `hello`, `set`, `reset`, `theme`, `lang`, `autostart`,
`share`, `shareVideo`, `openShare`, `revealShare`, `openWebsite`,
`autostartWarnSeen`.

Settings ← host: `init`, `icons`, `themeChanged`, `lang`, `autostart`,
`recProgress`, `shareResult`.

No prototype JavaScript changes are required: injected `BRIDGE_JS` installs
`window.chrome.webview` before page scripts run and forwards host messages to
registered `message` listeners.

## 3. Wallpaper layers

### X11

A `Gtk.Window` with `Gdk.WindowTypeHint.DESKTOP`, `keep_below`, all desktops
sticky and an empty input region. It is lowered periodically. Desktop icon
windows drawn by Nautilus/Plasma/xfdesktop remain above it.

If a window manager/file manager keeps raising its own desktop window above
ours, use `--static`; the host then renders frames and sets the real wallpaper.

### Wayland with wlr-layer-shell

`gtk3-layer-shell` places the view on the `background` layer, anchored to all
edges, on the primary output, with keyboard mode `none` and an empty input
region. Works on wlroots compositors (Sway, Hyprland, river) and on KWin
versions that expose layer-shell. Requires `gir1.2-gtklayershell-0.1`.

### Wayland without a usable background layer (GNOME Shell, KDE Plasma)

KWin accepts `zwlr_layer_shell_v1`, but its Plasma desktop containment sits
above the background layer, so the scene is invisible. The host therefore
selects the static fallback automatically on GNOME and KDE Wayland; wlroots
compositors keep the live layer.

`--static` fallback (automatic): the WebView lives in a transparent, mapped
render window (an `OffscreenWindow` has no GdkWindow and WebKitGTK cannot create
a GL context there); after a frame is committed the host takes a
`WebKitWebView` snapshot, writes a uniquely named
`~/.config/deskland/render-<ms>.png`, and applies it through the desktop's own
API:
`gsettings` (GNOME/Cinnamon/MATE), Plasma scripting over qdbus, `xfconf-query`,
or `feh --bg-fill`. Original values are captured and restored on exit.

Static fallback loses continuous animation. Icon changes still trigger a new
frame (900 ms debounce). If accelerated WebGL snapshots are blank on a
compositor, prefer layer-shell or run the GNOME Shell extension route (future
work).

### Why not Electron/Tauri?

WebKitGTK is the system WebView, GPL-compatible with this repository, and has a
small footprint. Electron would bundle a second Chromium runtime (~150 MB) and
still need native X11/Wayland code for the wallpaper layer. Tauri on Linux uses
WebKitGTK anyway. The only new requirement is the bridge shim, already
implemented in `bridge.py`.

## 4. Icon sources

| Desktop | Source | Notes |
| --- | --- | --- |
| GNOME / Nautilus | `metadata::nautilus-icon-position` via `gio info` | Works when icons are manually arranged. Auto-arranged icons fall back to the grid. |
| GNOME + Desktop Icons NG (ding) | `metadata::ding-icon-position` | Same `gio info` path. |
| Cinnamon / Nemo | `metadata::nemo-icon-position` | Best effort. |
| MATE / Caja | `metadata::caja-icon-position` | Best effort. |
| Xfce | `~/.config/xfce4/desktop/icons.screen0-*.rc` | Parser accepts `rowN`/`colN` sections and `rowNcolN` keys; unreadable entries use the grid. |
| KDE Plasma | `~/.cache/deskland/icons.json` via `org.deskland.iconspy` (fallback: `appletsrc`) | Pure-QML plasmoid (`linux/kde-iconspy/org.deskland.iconspy`) reads live `GridView` icon pixel geometry inside the desktop containment; `appletsrc` only stores cell indices on Plasma 6. |
| unknown/headless | deterministic 76×100 grid | Keeps the scene populated; not a real desktop layout. |

Verify the real values on a machine with:

```sh
gio info -a metadata::nautilus-icon-position -a metadata::ding-icon-position "$HOME/Desktop/example"
grep -n 'positions\|Image' ~/.config/plasma-org.kde.plasma.desktop-appletsrc
ls ~/.config/xfce4/desktop/
```

Force an adapter with `--icon-adapter gio|xfce|plasma|grid` or
`DESKLAND_ICON_ADAPTER=…`.

### KDE Plasma 6 pixel icon source (`org.deskland.iconspy`)

On KDE Plasma 6 (Wayland and X11), `plasma-org.kde.plasma.desktop-appletsrc`
only records grid ordering indices rather than pixel coordinates. The pure-QML
plasmoid in `linux/kde-iconspy/org.deskland.iconspy` runs invisibly inside the
primary desktop folder-view containment, walks its scene graph to locate the
`FolderView` `GridView`, and writes physical-pixel icon rectangles every 500 ms
to `~/.cache/deskland/icons.json` (read by the `org.deskland.preview`
wallpaper plugin's `inject.js`). When the widget is absent or stale (> 10 s), the
wallpaper falls back to the island-free scene (`vis: false`).

Install, upgrade, or remove the plasmoid:

```sh
kpackagetool6 --type Plasma/Applet -i linux/kde-iconspy/org.deskland.iconspy
kpackagetool6 --type Plasma/Applet --upgrade linux/kde-iconspy/org.deskland.iconspy
kpackagetool6 --type Plasma/Applet -r org.deskland.iconspy
```

## 5. Dependencies and run

Debian/Ubuntu names:

```sh
sudo apt install python3 python3-gi python3-gi-cairo \
  gir1.2-gtk-3.0 gir1.2-webkit2-4.0 \
  gir1.2-ayatanaappindicator3-0.1 libayatana-appindicator3-1 \
  gir1.2-gtklayershell-0.1 xdotool xdg-utils
```

Fedora/Arch equivalents: `python3-gobject`, `gtk3`, `webkit2gtk4.1`,
`libayatana-appindicator-gtk3`, `gtk-layer-shell`, `xdotool`, `xdg-utils`.

Run from the repository root:

```sh
./linux/run.sh                 # wallpaper + settings
./linux/run.sh --autostart     # background only (used by autostart)
./linux/run.sh --settings      # open settings
./linux/run.sh --exit          # restore wallpaper and quit
./linux/run.sh --static        # force the static fallback
./linux/run.sh --x11           # force X11 desktop window
./linux/run.sh --layer-shell   # force layer-shell
```

Environment:

| Variable | Purpose |
| --- | --- |
| `DESKLAND_PROFILE_DIR` | isolated settings/log/profile; disables autostart writes |
| `DESKLAND_PROTOTYPE` | prototype directory override |
| `DESKLAND_DESKTOP_DIR` | desktop directory override |
| `DESKLAND_PICTURES_DIR` | share output override |
| `DESKLAND_DEBUG=1` | mirror log lines to stderr |
| `DESKLAND_ICON_ADAPTER` | `gio`, `xfce`, `plasma`, `grid` |
| `DESKLAND_ICON_POS_PHYSICAL=1` | skip scale multiplication for positions |
| `DESKLAND_PAUSE_HELPER` | executable; exit 0 means "pause" (custom compositor) |

Settings: `~/.config/deskland/settings.json`
Log: `~/.config/deskland/host.log`
Autostart: `~/.config/autostart/deskland.desktop`
Shares: `~/Pictures/Deskland Preview/`

## 6. Packaging

Build a `.deb` (no extra tooling beyond `dpkg-deb`):

```sh
sh linux/packaging/build-deb.sh
```

The package installs to `/usr/lib/deskland`, with `/usr/bin/deskland-linux`,
a desktop entry and a scalable icon. Dependencies are declared in the control
file.

Build an Arch package with `makepkg` (same install layout, `arch=('any')`
because the host is pure Python):

```sh
cd linux/packaging/arch
makepkg -si
```

`PKGBUILD` pulls the upstream `main` archive; replace `source`/`sha256sums`
with a release tag and real checksum before publishing to the AUR. Arch
dependency names: `python-gobject`, `python-cairo`, `gtk3`,
`webkit2gtk-4.1`, `libayatana-appindicator`; optional `gtk-layer-shell` and
`xdotool`.

AppImage is not recommended: bundling WebKitGTK, GTK and GI typelibs creates a
very large, fragile image and WebKit needs matching host graphics drivers.
Flatpak is the better portable option; a manifest should use
`org.gnome.Platform`, add `--socket=wayland --socket=fallback-x11
--share=ipc`, and request filesystem access to the desktop directory plus
`~/.config/autostart` only if autostart is enabled.

## 7. Test plan

### Automated

```sh
cd linux
python3 -m pytest -q          # pytest is a dev dependency
python3 -m py_compile deskland_linux/*.py
```

Covered: position parsers, grid layout, settings round-trip, theme authorization,
i18n fallback, autostart entry, data-URL export.

### Manual matrix

| Environment | Session | Expected |
| --- | --- | --- |
| GNOME + Nautilus icons | X11 | Scene behind icons; moving an icon reshapes coast/clouds within ~0.5 s |
| GNOME + ding | Wayland | Same; layer-shell unavailable → static fallback, no continuous animation unless GNOME extension is added |
| KDE Plasma | X11 | Layer visible, tray menu, icon changes |
| KDE Plasma | Wayland | layer-shell if available; else static fallback |
| Xfce | X11 | Icons parsed from RC (or grid), layer visible, tray |
| Sway/Hyprland | Wayland | Background layer, no pointer capture |
| Any | X11 | Maximize/fullscreen window pauses; restoring resumes |
| Any | Wayland GNOME/KWin | Manual pause via tray; automatic pause only with helper |
| HiDPI 1.5×/2× | X11 + Wayland | Icon rectangles align; page divides physical px by `devicePixelRatio` |
| Hidden desktop icons | all | `vis:false` → empty icon list, scenery stays |
| Share image | all | PNG saved, clipboard image, sample icons only; no screenshot |
| Share video | WebKit with MediaRecorder | WebM/MP4 saved; settings shows preview |
| Autostart | login | Tray/wallpaper starts with `--autostart`, no settings window |
| Exit | all | Static fallback restores original wallpaper; layer window disappears |
| Second launch | all | GApplication routes to existing instance; `--settings` opens UI |

Debug aids:

```sh
DESKLAND_DEBUG=1 ./linux/run.sh --settings
tail -f ~/.config/deskland/host.log
gdbus introspect --session --dest app.deskland.Preview --object-path /app/deskland/Preview
```

Check for WebGL2 support in the settings preview; if the page reports no
WebGL2, update WebKitGTK or test with `WEBKIT_DISABLE_COMPOSITING_MODE=1`
(software rendering, slower).

## 8. Known limitations and mitigations

1. **Wayland has no global window geometry.** Automatic pause is implemented for
   Sway and Hyprland only. GNOME Shell/KWin need a compositor extension or
   `DESKLAND_PAUSE_HELPER`. Document this in the UI/log.
2. **GNOME Shell has no layer-shell.** Static wallpaper fallback is the only
   portable option. A GNOME extension could host a chrome-less window above the
   background but then icons hide the scene; the static route is safer.
3. **Icon storage is fragmented.** Nautilus/Ding metadata, Xfce RC and Plasma
   config are all unofficial. Adapters are best effort and fall back to a grid;
   they never crash the poller. Auto-arranged icons have no stored pixel
   positions.
4. **X11 stacking is compositor-dependent.** Some file managers raise their
   desktop window. If the scene disappears under the wallpaper, use `--static`.
5. **Plasma icon positions are undocumented.** The parser accepts common JSON
   `positions` maps; verify on the target Plasma version and prefer X11/static
   if positions are wrong.
6. **Static snapshots of accelerated WebGL may be blank.** Test on the target
   compositor; layer-shell is the primary path. Keep the WebView mapped for a
   short period if snapshots are empty.
7. **AppIndicator needs a shell extension** on GNOME (AppIndicator/KStatusNotifier
   extension). Without one, the tray is invisible; `--settings` and
   `--exit` still work.
8. **Clipboard file lists** (`set_uris`) may be ignored by some Wayland
   applications; image export uses a real pixbuf and works more widely.
9. **Only the primary monitor is covered**, matching the Windows Preview. The
   loopback server binds `127.0.0.1` on a random port; no external network.
10. **Security/Network:** pages are served from a local-only HTTP server with
    path traversal checks; share playback uses `/__share/<basename>` only.
    The desktop is never screenshotted; sharing uses icon positions and sample
    glyphs exactly like the Windows host.

## 9. Porting steps applied

1. Kept `prototype/` unchanged (themes, i18n, WebGL, share.js).
2. Replaced host startup with `DesklandApplication` (GApplication single
   instance, `--settings/--menu/--exit/--autostart`).
3. Replaced WebView2 with `BridgeWebView` and an injected shim.
4. Replaced ListView enumeration with `icons.py` adapters.
5. Replaced Progman/WorkerW attachment with `wallpaper.py` backends.
6. Replaced registry autostart with XDG autostart.
7. Replaced NotifyIcon with AppIndicator.
8. Ported settings protocol, theme switching, debounce save, i18n, pause,
   snapshot/record sharing and clipboard integration in `app.py`.
