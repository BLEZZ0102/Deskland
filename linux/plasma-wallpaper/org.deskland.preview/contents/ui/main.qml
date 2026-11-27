/*
 * Deskland wallpaper for KDE Plasma 6 (Wayland).
 *
 * The Plasma desktop containment is opaque and always sits above ordinary
 * windows, so the Deskland scene cannot be shown as a regular window or a
 * layer-shell surface — it has to BE the wallpaper. This plugin embeds the
 * Deskland theme page (the same HTML/WebGL scene the rest of the app uses)
 * in a WebEngineView and injects the bridge (inject.js) that keeps the
 * scene fed with live icon positions from the folder-view applet config and
 * with the Deskland settings (theme, seed, pause…).
 */

import QtQuick
import Qt.labs.platform
import QtWebEngine
import org.kde.plasma.plasmoid

WallpaperItem {
    id: root

    property string prototypeRoot: "file:///usr/lib/deskland/prototype/"
    property string theme: "meadow"
    property string homeDir: {
        var base = String(StandardPaths.writableLocation(StandardPaths.GenericConfigLocation));
        // "file:///home/user/.config" -> "/home/user"
        base = base.replace(/^file:\/\//, "");
        base = base.replace(/\/\.config\/?$/, "");
        return base.replace(/\/+$/, "");
    }

    WebEngineView {
        id: view
        anchors.fill: parent
        url: ""
        backgroundColor: "#000000"
        settings.localContentCanAccessFileUrls: true
        settings.localStorageEnabled: true
        settings.errorPageEnabled: false

        Component.onCompleted: {
            view.userScripts.collection = [
                { name: "deskland-bridge",
                  sourceUrl: Qt.resolvedUrl("inject.js"),
                  injectionPoint: WebEngineScript.DocumentCreation,
                  worldId: WebEngineScript.MainWorld }
            ];
            view.url = root.prototypeRoot + root.theme + ".html"
                + "?wallpaper=1&v=" + Date.now()
                + "&theme=" + encodeURIComponent(root.theme)
                + "&home=" + encodeURIComponent(root.homeDir);
        }

        onLoadingChanged: function (loadingInfo) {
            if (loadingInfo.status === WebEngineView.LoadFailedStatus) {
                console.warn("Deskland wallpaper: theme page failed to load");
            }
        }
    }
}
