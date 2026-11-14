/*
 * Deskland IconSpy plasmoid for KDE Plasma 6 (Wayland / X11).
 *
 * Runs invisibly inside the desktop folder-view containment, locates the
 * containment's FolderView GridView in the QML scene graph, and writes
 * physical-pixel icon rectangles every 500 ms to ~/.cache/deskland/icons.json
 * using an atomic rename.
 */

import QtQuick
import QtQuick.Layouts
import QtQuick.Window
import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.plasmoid
import org.kde.plasma.plasma5support as Plasma5Support

PlasmoidItem {
    id: root

    Plasmoid.backgroundHints: PlasmaCore.Types.NoBackground
    Layout.preferredWidth: 1
    Layout.preferredHeight: 1
    Layout.minimumWidth: 1
    Layout.minimumHeight: 1
    implicitWidth: 1
    implicitHeight: 1
    opacity: 0
    enabled: false

    property var cachedGridView: null
    property bool execBusy: false
    property double execStartedAt: 0

    Plasma5Support.DataSource {
        id: writer
        engine: "executable"
        connectedSources: []
        onNewData: function (sourceName, data) {
            disconnectSource(sourceName);
            root.execBusy = false;
        }
    }

    function toBase64Utf8(str) {
        var bytes = [];
        for (var i = 0; i < str.length; i++) {
            var c = str.charCodeAt(i);
            if (c < 0x80) {
                bytes.push(c);
            } else if (c < 0x800) {
                bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
            } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
                var c2 = str.charCodeAt(++i);
                var cp = 0x10000 + (((c & 0x3ff) << 10) | (c2 & 0x3ff));
                bytes.push(
                    0xf0 | (cp >> 18),
                    0x80 | ((cp >> 12) & 0x3f),
                    0x80 | ((cp >> 6) & 0x3f),
                    0x80 | (cp & 0x3f)
                );
            } else {
                bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
            }
        }
        var tbl = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        var out = "";
        for (var j = 0; j < bytes.length; j += 3) {
            var b0 = bytes[j];
            var b1 = j + 1 < bytes.length ? bytes[j + 1] : 0;
            var b2 = j + 2 < bytes.length ? bytes[j + 2] : 0;
            out += tbl[b0 >> 2];
            out += tbl[((b0 & 3) << 4) | (b1 >> 4)];
            out += (j + 1 < bytes.length) ? tbl[((b1 & 15) << 2) | (b2 >> 6)] : "=";
            out += (j + 2 < bytes.length) ? tbl[b2 & 63] : "=";
        }
        return out;
    }

    function writeJson(obj) {
        var now = Date.now();
        if (root.execBusy && (now - root.execStartedAt) < 2500) {
            return;
        }
        try {
            var json = JSON.stringify(obj);
            var b64 = toBase64Utf8(json);
            var cmd = "sh -c 'mkdir -p \"$HOME/.cache/deskland\" && printf \"%s\" \"" + b64
                + "\" | base64 -d > \"$HOME/.cache/deskland/icons.json.tmp\" && mv -f \"$HOME/.cache/deskland/icons.json.tmp\" \"$HOME/.cache/deskland/icons.json\"'";
            root.execBusy = true;
            root.execStartedAt = now;
            writer.connectSource(cmd);
        } catch (e) {
            root.execBusy = false;
        }
    }

    function findContainmentRoot() {
        var cur = root;
        while (cur) {
            if (cur.plasmoid !== undefined && cur.plasmoid !== null && cur.plasmoid.isContainment) {
                return cur;
            }
            if (!cur.parent) {
                return cur;
            }
            cur = cur.parent;
        }
        return null;
    }

    function isPrimaryContainment(top) {
        if (!top) return false;
        if (top.screen !== undefined && top.screen !== 0) {
            return false;
        }
        try {
            var screens = Qt.application.screens;
            if (screens && screens.length > 0 && top.screenGeometry) {
                var p = screens[0];
                if (top.screenGeometry.x !== p.virtualX || top.screenGeometry.y !== p.virtualY) {
                    return false;
                }
            }
        } catch (e) {
            // Fall back to top.screen === 0
        }
        return true;
    }

    function findGridView(item, depth) {
        if (!item || depth > 25) return null;
        var kids = item.children;
        if (!kids) return null;
        for (var i = 0; i < kids.length; i++) {
            var it = kids[i];
            if (it && it.cellWidth !== undefined && it.cellHeight !== undefined
                    && it.model !== undefined && it.count !== undefined
                    && it.itemAtIndex !== undefined) {
                return it;
            }
            var found = findGridView(it, depth + 1);
            if (found) return found;
        }
        return null;
    }

    function collectRects(top, gv) {
        var rects = [];
        var win = root.Window ? root.Window.window : null;
        var dpr = (win && win.devicePixelRatio > 0) ? win.devicePixelRatio : 1;
        var originX = 0;
        var originY = 0;
        if (top.screenGeometry) {
            originX = top.screenGeometry.x || 0;
            originY = top.screenGeometry.y || 0;
        }
        var topGlobal = top.mapToGlobal(0, 0);
        var cnt = Math.min(gv.count || 0, 4096);
        for (var i = 0; i < cnt; i++) {
            var it = gv.itemAtIndex(i);
            if (!it || it.blank === true || !it.visible) continue;
            var pos;
            try {
                pos = it.mapToItem(top, 0, 0);
            } catch (e) {
                var g = it.mapToGlobal(0, 0);
                pos = { x: g.x - topGlobal.x - originX, y: g.y - topGlobal.y - originY };
            }
            var w = (it.width > 0) ? it.width : gv.cellWidth;
            var h = (it.height > 0) ? it.height : gv.cellHeight;
            if (w <= 0 || h <= 0) continue;
            var l = Math.round(pos.x * dpr);
            var t = Math.round(pos.y * dpr);
            var r = Math.round((pos.x + w) * dpr);
            var b = Math.round((pos.y + h) * dpr);
            rects.push([l, t, r, b]);
        }
        return rects;
    }

    Timer {
        id: pollTimer
        interval: 500
        repeat: true
        running: true
        triggeredOnStart: true
        onTriggered: {
            try {
                var top = root.findContainmentRoot();
                if (!root.isPrimaryContainment(top)) {
                    return;
                }
                var gv = root.cachedGridView;
                if (gv) {
                    try {
                        if (gv.count === undefined || gv.cellWidth === undefined || !gv.visible) {
                            gv = null;
                        }
                    } catch (e) {
                        gv = null;
                    }
                }
                if (!gv && top) {
                    gv = root.findGridView(top, 0);
                }
                root.cachedGridView = gv;
                if (!gv) {
                    root.writeJson({ ts: Date.now(), vis: false, r: [] });
                    return;
                }
                var rects = root.collectRects(top, gv);
                root.writeJson({ ts: Date.now(), vis: true, r: rects });
            } catch (e) {
                root.writeJson({ ts: Date.now(), vis: false, r: [] });
            }
        }
    }
}
