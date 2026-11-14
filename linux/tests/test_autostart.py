from deskland_linux import autostart


def test_autostart_roundtrip(tmp_path, monkeypatch):
    target = tmp_path / "autostart" / "deskland.desktop"
    monkeypatch.setattr(autostart, "autostart_path", lambda: target)
    assert autostart.is_enabled() is False
    assert autostart.set_enabled(True) is True
    text = target.read_text(encoding="utf-8")
    assert "Type=Application" in text
    assert "--autostart" in text
    assert autostart.is_enabled() is True
    assert autostart.set_enabled(False) is True
    assert target.exists() is False
