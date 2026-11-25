"""OSS key layout (ROADMAP P2-05, P0-13, P0-14).

Must stay identical to apps/api/src/modules/storage/storage.types.ts — both test suites assert the
same vector.

    quarantine/{tenant}/{material}/{attempt}/{uuid}.pdf          upload (quarantine bucket)
    published|previews|results/{tenant}/{material}/{attempt}/{versionTag}.{ext}   (published bucket)
"""
from __future__ import annotations

import re
from typing import NamedTuple, Optional

_UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
_QUARANTINE_RE = re.compile(rf"quarantine/({_UUID})/({_UUID})/([1-9][0-9]{{0,2}})/{_UUID}\.pdf")


class Source(NamedTuple):
    tenant_id: str
    material_id: str
    attempt: int


def parse_quarantine_key(key: str) -> Optional[Source]:
    m = _QUARANTINE_RE.fullmatch(key)
    return Source(m.group(1), m.group(2), int(m.group(3))) if m else None


def version_tag(version_id: Optional[str]) -> str:
    """Key-safe form of an OSS version ID."""
    return re.sub(r"[^A-Za-z0-9_-]", "_", version_id or "")[:120] or "noversion"


def output_key(prefix: str, source: Source, version_id: Optional[str], ext: str) -> str:
    return f"{prefix}/{source.tenant_id}/{source.material_id}/{source.attempt}/{version_tag(version_id)}.{ext}"
