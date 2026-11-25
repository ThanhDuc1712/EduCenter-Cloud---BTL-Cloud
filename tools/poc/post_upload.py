"""Giả lập trình duyệt upload PostObject lên OSS quarantine — CHỈ dùng để Giang kiểm OSS -> FC
khi app chưa có signer (P0-17). Không deploy, không dùng trên demo.

Khóa: dùng RAM user tạm `giang-poc-uploader` (chỉ PutObject vào quarantine/<tenant PoC>/*).
Đặt khóa vào biến môi trường của cửa sổ PowerShell hiện tại, không lưu vào file:
  $env:OSS_POC_AK_ID = Read-Host "AccessKey ID"
  $env:OSS_POC_AK_SECRET = Read-Host "AccessKey Secret"   (dán, Enter)
Ví dụ:
  python tools\\poc\\post_upload.py --bucket educenter-xxx-quarantine --file valid-2mb.pdf --run R01
Mỗi lần chạy ghi thêm 1 dòng vào measurements.csv (chặng Client -> OSS).
"""
import argparse
import base64
import csv
import hashlib
import hmac
import json
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import requests

MAX_BYTES = 10 * 1024 * 1024


def build_policy(bucket: str, key: str, cid: str, expire_seconds: int) -> str:
    exp = datetime.now(timezone.utc) + timedelta(seconds=expire_seconds)
    policy = {
        "expiration": exp.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "conditions": [
            {"bucket": bucket},
            ["eq", "$key", key],                       # đúng một key
            ["content-length-range", 1, MAX_BYTES],    # <= 10 MB
            ["eq", "$x-oss-meta-correlation-id", cid],
        ],
    }
    return base64.b64encode(json.dumps(policy).encode()).decode()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bucket", required=True)
    ap.add_argument("--region", default="ap-southeast-1")
    ap.add_argument("--file", required=True)
    ap.add_argument("--run", default="R00", help="mã lần chạy, ví dụ R01")
    ap.add_argument("--key", help="ép dùng key cố định (để thử 2 version cùng key)")
    ap.add_argument("--sign-key", help="key ghi trong policy, khác --key để thử 'sai key bị từ chối'")
    ap.add_argument("--expire-seconds", type=int, default=300, help="âm để thử policy hết hạn")
    ap.add_argument("--csv", default="measurements.csv")
    a = ap.parse_args()

    ak_id, ak_secret = os.environ.get("OSS_POC_AK_ID"), os.environ.get("OSS_POC_AK_SECRET")
    if not ak_id or not ak_secret:
        raise SystemExit("Chua dat OSS_POC_AK_ID / OSS_POC_AK_SECRET trong cua so PowerShell nay")

    cid = f"poc-{a.run}-{uuid.uuid4().hex[:12]}"
    # Key đúng P2-05: quarantine/{tenant}/{material}/{attempt}/{uuid}.pdf; tenant PoC cố định, material ngẫu nhiên
    key = a.key or f"quarantine/00000000-0000-4000-8000-000000000000/{uuid.uuid4()}/1/{uuid.uuid4()}.pdf"
    policy_b64 = build_policy(a.bucket, a.sign_key or key, cid, a.expire_seconds)
    signature = base64.b64encode(hmac.new(ak_secret.encode(), policy_b64.encode(), hashlib.sha1).digest()).decode()

    fields = {
        "key": key,
        "OSSAccessKeyId": ak_id,
        "policy": policy_b64,
        "Signature": signature,
        "x-oss-meta-correlation-id": cid,
    }
    url = f"https://{a.bucket}.oss-{a.region}.aliyuncs.com"
    size = os.path.getsize(a.file)
    with open(a.file, "rb") as fh:
        t0 = time.perf_counter()
        resp = requests.post(url, data=fields, files={"file": (os.path.basename(a.file), fh, "application/pdf")},
                             timeout=120)
        ms = round((time.perf_counter() - t0) * 1000, 1)

    version = resp.headers.get("x-oss-version-id", "")
    err_code = ""
    if resp.status_code >= 300 and "<Code>" in resp.text:
        err_code = resp.text.split("<Code>")[1].split("</Code>")[0]
    now = datetime.now().astimezone().isoformat(timespec="seconds")
    print(f"run={a.run} http={resp.status_code} {err_code} durationMs={ms} bytes={size}")
    print(f"correlationId={cid}")
    print(f"key={key}")
    print(f"versionId={version[:16]}...{version[-6:]}" if version else "versionId=(khong co)")

    new = not os.path.exists(a.csv)
    with open(a.csv, "a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        if new:
            w.writerow(["run", "time", "leg", "bytes", "http", "error", "durationMs", "correlationId", "key", "note"])
        w.writerow([a.run, now, "Client->OSS", size, resp.status_code, err_code, ms, cid, key, os.path.basename(a.file)])


if __name__ == "__main__":
    main()
