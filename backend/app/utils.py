from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone

from .schemas import PostingPackage


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def package_hash(package: PostingPackage) -> str:
    payload = package.model_dump(mode="json")
    payload["gross"] = format(package.gross, ".2f")
    payload["invoice"]["net"] = format(package.invoice.net, ".2f")
    payload["invoice"]["vat"] = format(package.invoice.vat, ".2f")
    data = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def safe_filename(filename: str | None) -> str:
    basename = (filename or "invoice.pdf").replace("\\", "/").rsplit("/", 1)[-1]
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "_", basename).strip(".")[:120]
    return cleaned or "invoice.pdf"
