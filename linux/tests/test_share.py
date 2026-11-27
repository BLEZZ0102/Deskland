import base64

from deskland_linux.share import data_url_bytes, save_share


def test_data_url_decoding():
    raw = b"\x89PNG\r\n"
    url = "data:image/png;base64," + base64.b64encode(raw).decode()
    assert data_url_bytes(url) == raw


def test_save_share_names(tmp_path):
    url = "data:image/png;base64," + base64.b64encode(b"x").decode()
    path = save_share(url, tmp_path, "image")
    assert path.suffix == ".png"
    assert path.read_bytes() == b"x"


def test_save_video_extension(tmp_path):
    url = "data:video/webm;base64," + base64.b64encode(b"v").decode()
    path = save_share(url, tmp_path, "video", "video/webm")
    assert path.suffix == ".webm"
