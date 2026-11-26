from __future__ import annotations

from fastapi import HTTPException

from ..config import ALLOWED_EXTENSIONS, MAX_UPLOAD_MB

_SIGNATURES = {
    ".pdf": (b"%PDF-", "PDF"),
    ".png": (b"\x89PNG\r\n\x1a\n", "PNG"),
    ".jpg": (b"\xff\xd8\xff", "JPEG"),
    ".jpeg": (b"\xff\xd8\xff", "JPEG"),
}


def check_extension(extension: str) -> None:
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=415, detail="Supported formats: PDF, PNG, JPG, JPEG"
        )


def check_content(extension: str, content: bytes) -> None:
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if len(content) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(
            status_code=413, detail=f"Maximum upload size is {MAX_UPLOAD_MB} MB"
        )
    # Lightweight signature check so we do not trust the filename alone.
    magic, label = _SIGNATURES[extension]
    if not content.startswith(magic):
        raise HTTPException(
            status_code=415, detail=f"The uploaded file does not look like a {label}"
        )
