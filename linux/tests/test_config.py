import json

from deskland_linux.config import SettingsStore, ThemeRegistry, I18n


class DummyLog:
    def write(self, _message):
        pass

    def exception(self, _message, _exc):
        pass


def test_settings_roundtrip(tmp_path):
    store = SettingsStore(tmp_path)
    store.theme = "meadow"
    store.lang = "en"
    store.for_theme("meadow")["sigma"] = 120
    store.save()

    other = SettingsStore(tmp_path)
    other.load()
    assert other.theme == "meadow"
    assert other.lang == "en"
    assert other.for_theme("meadow")["sigma"] == 120


def test_settings_tolerates_broken_json(tmp_path):
    (tmp_path / "settings.json").write_text("{broken", encoding="utf-8")
    store = SettingsStore(tmp_path)
    store.load()
    assert store.theme == "beach"


def test_theme_registry_free_only(tmp_path):
    data = {
        "themes": [
            {"id": "beach", "status": "ready", "product": "free", "page": "flat.html"},
            {"id": "locked", "status": "locked", "locked": True},
        ]
    }
    (tmp_path / "themes.json").write_text(json.dumps(data), encoding="utf-8")
    registry = ThemeRegistry(tmp_path, DummyLog())
    assert registry.page_for("beach") == "flat.html"
    assert registry.allowed("beach") is True
    assert registry.allowed("locked") is False


def test_i18n_fallback(tmp_path):
    (tmp_path / "i18n").mkdir()
    (tmp_path / "i18n" / "en.json").write_text(
        json.dumps({"host": {"trayPause": "Pause {name}"}}), encoding="utf-8"
    )
    i18n = I18n(tmp_path, "en", DummyLog())
    assert i18n.t("trayPause", name="now") == "Pause now"
    assert i18n.t("missingKey") == "missingKey"
