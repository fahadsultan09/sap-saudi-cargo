"""Tests for the email intake attachment helper."""

import base64
import os

from email_intake import save_attachment_to_temp


def test_saves_attachment_with_original_suffix():
    path = save_attachment_to_temp(
        {"name": "inv.pdf", "contentBytes": base64.b64encode(b"%PDF-1.4 test").decode()}
    )
    try:
        assert path and path.endswith(".pdf")
        with open(path, "rb") as fh:
            assert fh.read() == b"%PDF-1.4 test"
    finally:
        if path and os.path.exists(path):
            os.remove(path)


def test_missing_content_returns_none():
    assert save_attachment_to_temp({"name": "inv.pdf"}) is None
