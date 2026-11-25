"""HMAC-SHA256 signed callback to the Azure API (contract: apps/api/src/modules/materials/hmac.ts).

    X-Edu-Key-Id:    key identifier
    X-Edu-Timestamp: unix seconds
    X-Edu-Signature: v1=hex(HMAC-SHA256(secret, f"{timestamp}.{raw_body}"))
"""
from __future__ import annotations

import hashlib
import hmac
import time
import urllib.error
import urllib.request
from typing import Callable, Optional


def compute_signature(secret: str, timestamp: str, raw_body: bytes) -> str:
    return hmac.new(secret.encode("utf-8"), timestamp.encode("ascii") + b"." + raw_body, hashlib.sha256).hexdigest()


def sign_headers(key_id: str, secret: str, raw_body: bytes, now: Optional[float] = None) -> dict:
    ts = str(int(now if now is not None else time.time()))
    return {
        "X-Edu-Key-Id": key_id,
        "X-Edu-Timestamp": ts,
        "X-Edu-Signature": "v1=" + compute_signature(secret, ts, raw_body),
        "Content-Type": "application/json",
    }


def http_post(url: str, body: bytes, headers: dict, timeout: float) -> int:
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:  # noqa: S310 (URL comes from configuration)
            return res.status
    except urllib.error.HTTPError as err:
        return err.code


def send_callback(
    url: str,
    key_id: str,
    secret: str,
    raw_body: bytes,
    log: Callable[..., None],
    post: Callable[[str, bytes, dict, float], int] = http_post,
    delays: tuple = (0, 1, 3, 8),
    timeout: float = 10.0,
) -> bool:
    """Signs (fresh timestamp per attempt) and POSTs with bounded retries. 4xx is not retried."""
    for attempt, delay in enumerate(delays, start=1):
        if delay:
            time.sleep(delay)
        started = time.monotonic()
        try:
            status = post(url, raw_body, sign_headers(key_id, secret, raw_body), timeout)
        except Exception as exc:  # network errors
            status = None
            log("WARN", "callback.error", attempt=attempt, error=type(exc).__name__)
        elapsed = int((time.monotonic() - started) * 1000)
        if status is not None:
            log("INFO" if status < 300 else "WARN", "callback.response", attempt=attempt, status=status, durationMs=elapsed)
            if status < 300:
                return True
            if 400 <= status < 500:
                return False
        if attempt < len(delays):
            log("WARN", "callback.retry", attempt=attempt)
    return False
