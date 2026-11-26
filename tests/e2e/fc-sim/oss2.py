"""Minimal stand-in for the `oss2` SDK, backed by the API's LOCAL storage directory.

Only the calls functions/material-processor makes (signatures as in oss2 2.16.0, the version built into
the Function Compute python3.10 runtime). SIMULATION: nothing here talks to Alibaba Cloud.
"""
import json
import os
from types import SimpleNamespace

ROOT = os.environ.get("SIM_STORAGE_DIR", "/storage")
# Bucket names the LOCAL storage provider of the API uses as folder names.
FOLDERS = {os.environ.get("QUARANTINE_BUCKET", ""): "educenter-quarantine-local",
           os.environ.get("PUBLISHED_BUCKET", ""): "educenter-published-local"}


class _NotFound(Exception):
    pass


class _NoSuchKey(_NotFound):
    pass


exceptions = SimpleNamespace(NotFound=_NotFound, NoSuchKey=_NoSuchKey)


class StsAuth:
    def __init__(self, access_key_id, access_key_secret, security_token, auth_version="v1"):
        pass


class Bucket:
    def __init__(self, auth, endpoint, bucket_name):
        self.dir = os.path.join(ROOT, FOLDERS[bucket_name])

    def _read(self, key, params):
        path = os.path.join(self.dir, *key.split("/"))
        if not os.path.isfile(path):
            raise _NoSuchKey(key)
        with open(path + ".meta.json", encoding="utf-8") as f:
            sidecar = json.load(f)
        wanted = (params or {}).get("versionId")
        if wanted and wanted != sidecar["versionId"]:
            raise _NoSuchKey(f"{key}?versionId={wanted}")
        return path, sidecar

    def head_object(self, key, headers=None, params=None):
        path, sidecar = self._read(key, params)
        meta = {f"x-oss-meta-{k}": v for k, v in sidecar["metadata"].items()}
        return SimpleNamespace(content_length=os.path.getsize(path), headers={**meta, "x-oss-version-id": sidecar["versionId"]})

    def get_object(self, key, byte_range=None, headers=None, progress_callback=None, process=None, params=None):
        path, _ = self._read(key, params)
        return open(path, "rb")

    def put_object(self, key, data, headers=None, progress_callback=None):
        path = os.path.join(self.dir, *key.split("/"))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)
        version = f"sim{os.urandom(6).hex()}"
        content_type = (headers or {}).get("Content-Type", "application/octet-stream")
        with open(path + ".meta.json", "w", encoding="utf-8") as f:
            json.dump({"contentType": content_type, "versionId": version, "metadata": {}, "versions": []}, f)
