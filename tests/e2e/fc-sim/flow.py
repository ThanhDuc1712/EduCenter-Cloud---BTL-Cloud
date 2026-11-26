"""Cross-cloud flow with SIMULATED Alibaba services against a real running API.

  create material -> check OSS key -> upload -> real worker handler (fake oss2) -> HMAC callback over
  HTTP -> the API applies it to that material.  Also: wrong secret, lost callback + reconciler, retry.

The API must run with PROCESSING_PROVIDER=aliyun-fc (so nothing is processed in-process),
STORAGE_PROVIDER=local, AUTH_MODE=demo and PROCESSING_TIMEOUT_SECONDS=30.
Run it through tests/e2e/fc-sim/run.ps1.
"""
import json
import os
import re
import sys
import time
import types
import urllib.error
import urllib.request
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [HERE, os.path.join(HERE, "..", "..", "..", "functions", "material-processor")]
import index  # noqa: E402  (imports the fake oss2 from HERE when the handler runs)
import oss2  # noqa: E402

BASE = os.environ["API_BASE"].rstrip("/")
ORIGIN = os.environ["APP_ORIGIN"]
PASSED = 0
COOKIE = ""
UUID = r"[0-9a-f-]{36}"


def check(name, ok, detail=""):
    global PASSED
    print(f"{'PASS' if ok else 'FAIL'}  {name}{'  - ' + str(detail) if detail else ''}", flush=True)
    if not ok:
        sys.exit(1)
    PASSED += 1


def http(method, path, body=None, raw=None, headers=None):
    global COOKIE
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    h = {"origin": ORIGIN, **({"content-type": "application/json"} if body is not None else {}), **({"cookie": COOKIE} if COOKIE else {}), **(headers or {})}
    req = urllib.request.Request(f"{BASE}/api/v1{path}", data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            status, text, cookie = res.status, res.read(), res.headers.get("set-cookie")
    except urllib.error.HTTPError as err:
        status, text, cookie = err.code, err.read(), None
    if cookie:
        COOKIE = cookie.split(";")[0]
    return status, json.loads(text) if text else None


def make_pdf():
    import io
    from pypdf import PdfWriter

    w = PdfWriter()
    for _ in range(2):
        w.add_blank_page(width=595, height=842)
    w.add_metadata({"/Title": "Mô phỏng FC"})
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


def create_and_upload(course_id, pdf):
    status, created = http("POST", "/materials", {"title": f"FC sim {uuid.uuid4().hex[:6]}", "category": "LECTURE", "visibility": "COURSE", "courseId": course_id, "filename": "sim.pdf", "contentType": "application/pdf", "size": len(pdf)})
    check("create material + upload policy", status == 201, status)
    target, material_id = created["upload"], created["material"]["id"]
    boundary = uuid.uuid4().hex
    parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode() for k, v in target["fields"].items()]
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="sim.pdf"\r\nContent-Type: application/pdf\r\n\r\n'.encode() + pdf + f"\r\n--{boundary}--\r\n".encode())
    url = target["url"] if target["url"].startswith("http") else f"{BASE}{target['url']}"
    req = urllib.request.Request(url, data=b"".join(parts), headers={"content-type": f"multipart/form-data; boundary={boundary}"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as res:
        check("direct upload to quarantine", res.status == 204, res.status)
    status, material = http("POST", f"/materials/{material_id}/complete")
    check("upload confirmed -> PROCESSING (waiting for the function)", material["status"] == "PROCESSING", material["status"])
    return material_id


def quarantine_keys(material_id):
    root = os.path.join(oss2.ROOT, "educenter-quarantine-local")
    found = []
    for folder, _, files in os.walk(os.path.join(root, "quarantine")):
        found += [os.path.relpath(os.path.join(folder, f), root).replace(os.sep, "/") for f in files if f.endswith(".pdf")]
    return sorted(k for k in found if f"/{material_id}/" in k)


def oss_event(key):
    with open(os.path.join(oss2.ROOT, "educenter-quarantine-local", *key.split("/")) + ".meta.json", encoding="utf-8") as f:
        version = json.load(f)["versionId"]
    return version, json.dumps({"events": [{"eventName": "ObjectCreated:PostObject", "oss": {"bucket": {"name": os.environ["QUARANTINE_BUCKET"]}, "object": {"key": key, "versionId": version}}}]}).encode()


def invoke(key):
    """Runs the deployed entry point exactly as Function Compute would."""
    context = types.SimpleNamespace(request_id=str(uuid.uuid4()), credentials=types.SimpleNamespace(access_key_id="sim", access_key_secret="sim", security_token="sim"))
    version, event = oss_event(key)
    return version, json.loads(index.handler(event, context))["processed"][0]


def main():
    check("API healthy", http("GET", "/health")[0] == 200)
    check("demo admin context", http("PUT", "/context", {"personaKey": "admin"})[0] == 200)
    course_id = http("GET", "/courses?pageSize=5&status=ACTIVE")[1]["items"][0]["id"]
    pdf = make_pdf()
    secret, url = os.environ["CALLBACK_HMAC_SECRET"], os.environ["CALLBACK_URL"]

    # 1. Happy path
    material_id = create_and_upload(course_id, pdf)
    bystander = create_and_upload(course_id, pdf)
    keys = quarantine_keys(material_id)
    check("OSS key follows quarantine/{tenant}/{material}/{attempt}/{uuid}.pdf", len(keys) == 1 and re.fullmatch(f"quarantine/{UUID}/{material_id}/1/{UUID}[.]pdf", keys[0]), keys)
    tenant = keys[0].split("/")[1]
    version, out = invoke(keys[0])
    check("worker processed and the API accepted its signed callback", out["status"] == "READY", out)
    material = http("GET", f"/materials/{material_id}")[1]
    check("that material is READY with the worker's result", material["status"] == "READY" and material["pageCount"] == 2 and material["hasPreview"] and material["latestJob"]["processor"] == "ALIYUN_FC", f"{material['status']}, {material['pageCount']} pages, {material['latestJob']['processor']}")
    check("the other material is untouched", http("GET", f"/materials/{bystander}")[1]["status"] == "PROCESSING")
    for prefix, ext in (("published", "pdf"), ("previews", "png"), ("results", "json")):
        key = f"{prefix}/{tenant}/{material_id}/1/{version}.{ext}"
        check(f"output object {prefix}/", os.path.isfile(os.path.join(oss2.ROOT, "educenter-published-local", *key.split("/"))), key)
    for role in ("quarantine", "published"):
        view = http("GET", f"/cloud/storage?bucket={role}&limit=1000")[1]
        owned = [o for o in view["objects"] if f"/{material_id}/" in o["key"]]
        check(f"cloud storage page lists {role} objects and links them to the material", owned and all((o["material"] or {}).get("id") == material_id for o in owned), f"{len(owned)} object(s), prefix '{view['prefix']}'")
    access = http("GET", f"/materials/{material_id}/access?kind=download")[1]
    with urllib.request.urlopen(f"{BASE}{access['url']}", timeout=30) as res:
        check("download returns the uploaded bytes", res.read() == pdf)

    # 2. Wrong HMAC secret -> 401, nothing changes
    os.environ["CALLBACK_HMAC_SECRET"] = "wrong-secret-" + "0" * 40
    try:
        invoke(quarantine_keys(bystander)[0])
        check("callback with a wrong secret is refused", False)
    except RuntimeError as err:
        check("callback with a wrong secret is refused", "callback" in str(err), err)
    os.environ["CALLBACK_HMAC_SECRET"] = secret
    check("material stays PROCESSING after the refused callback", http("GET", f"/materials/{bystander}")[1]["status"] == "PROCESSING")

    # 3. Lost callback: the stored results/ JSON is applied by the reconciler
    lost = create_and_upload(course_id, pdf)
    os.environ["CALLBACK_URL"] = "http://127.0.0.1:9/unreachable"
    try:
        invoke(quarantine_keys(lost)[0])
        check("unreachable callback makes the function fail", False)
    except RuntimeError:
        check("unreachable callback makes the function fail (FC would retry)", True)
    os.environ["CALLBACK_URL"] = url

    # 4. Retry: new attempt key; the old attempt cannot overwrite it
    stuck = create_and_upload(course_id, pdf)
    first = quarantine_keys(stuck)[0]
    status, _ = http("POST", f"/materials/{stuck}/retry")
    check("retry accepted", status == 201, status)
    second = [k for k in quarantine_keys(stuck) if k != first]
    check("retry copied the upload to the attempt 2 key", len(second) == 1 and f"/{stuck}/2/" in second[0], second)
    _, late = invoke(first)
    check("late result of attempt 1 is not applied", http("GET", f"/materials/{stuck}")[1]["status"] == "PROCESSING", late)
    invoke(second[0])
    done = http("GET", f"/materials/{stuck}")[1]
    check("attempt 2 result applied", done["status"] == "READY" and done["latestJob"]["attempt"] == 2, f"{done['status']}, attempt {done['latestJob']['attempt']}")

    print("      waiting for the processing timeout before reconciling ...", flush=True)
    time.sleep(35)
    status, summary = http("POST", "/cloud/reconciler/run")
    check("reconciler ran", status in (200, 201), summary)
    check("reconciler applied the stored result of the lost callback", http("GET", f"/materials/{lost}")[1]["status"] == "READY", summary)

    print(f"\n{PASSED} checks passed (Alibaba OSS / Function Compute SIMULATED)")


if __name__ == "__main__":
    main()
