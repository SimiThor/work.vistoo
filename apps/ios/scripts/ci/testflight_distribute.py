#!/usr/bin/env python3
"""Waits until App Store Connect has processed an uploaded build and makes it available
to the given INTERNAL TestFlight groups. Never touches external groups, beta review or
App Store submission.

Standard library only (+ the `openssl` CLI for the ES256 JWT), so it runs on any runner.

Environment: ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY (content of the .p8)
Usage: testflight_distribute.py --bundle-id de.vistoo.work --build 202611091200 \
         [--groups "Vistoo Team"] [--timeout-min 45]
       testflight_distribute.py --self-test   (offline JWT check, no network)
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.appstoreconnect.apple.com/v1"


def gh(kind: str, msg: str, title: str = "TestFlight") -> None:
    """GitHub Actions annotation (plain line outside Actions)."""
    if os.environ.get("GITHUB_ACTIONS") == "true":
        print(f"::{kind} title={title}::{msg}", flush=True)
    else:
        print(f"{kind.upper()}: {msg}", flush=True)


def summary(line: str) -> None:
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(line + "\n")


class Fail(Exception):
    pass


# --- JWT (ES256) ---------------------------------------------------------------------------

def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def der_to_raw(sig: bytes) -> bytes:
    """ECDSA DER signature (SEQUENCE{INTEGER r, INTEGER s}) → 64-byte r||s for JWS."""
    def read_int(buf: bytes, i: int) -> tuple[int, int]:
        if buf[i] != 0x02:
            raise ValueError("bad DER integer")
        n = buf[i + 1]
        return int.from_bytes(buf[i + 2 : i + 2 + n], "big"), i + 2 + n

    if sig[0] != 0x30:
        raise ValueError("bad DER sequence")
    i = 3 if sig[1] & 0x80 else 2  # long-form length never happens for P-256, but be safe
    r, i = read_int(sig, i)
    s, _ = read_int(sig, i)
    return r.to_bytes(32, "big") + s.to_bytes(32, "big")


def make_jwt(key_id: str, issuer: str, pem: str, ttl: int = 1200) -> str:
    now = int(time.time())
    header = {"alg": "ES256", "kid": key_id, "typ": "JWT"}
    payload = {"iss": issuer, "iat": now, "exp": now + ttl, "aud": "appstoreconnect-v1"}
    signing_input = f"{b64url(json.dumps(header).encode())}.{b64url(json.dumps(payload).encode())}"
    with tempfile.NamedTemporaryFile("w", suffix=".p8", delete=False) as f:
        f.write(pem.strip() + "\n")
        key_path = f.name
    try:
        os.chmod(key_path, 0o600)
        der = subprocess.run(
            ["openssl", "dgst", "-sha256", "-sign", key_path],
            input=signing_input.encode(), capture_output=True, check=True,
        ).stdout
    except subprocess.CalledProcessError:
        raise Fail("ASC_PRIVATE_KEY is not a valid EC private key (.p8 content).") from None
    finally:
        os.unlink(key_path)
    return f"{signing_input}.{b64url(der_to_raw(der))}"


# --- API ------------------------------------------------------------------------------------

class Client:
    def __init__(self, key_id: str, issuer: str, pem: str):
        self.key_id, self.issuer, self.pem = key_id, issuer, pem
        self.token, self.token_born = "", 0.0

    def _auth(self) -> str:
        if time.time() - self.token_born > 900:  # refresh well before the 20-min expiry
            self.token, self.token_born = make_jwt(self.key_id, self.issuer, self.pem), time.time()
        return self.token

    def request(self, method: str, path: str, params: dict | None = None, body: dict | None = None):
        url = API + path + ("?" + urllib.parse.urlencode(params) if params else "")
        data = json.dumps(body).encode() if body is not None else None
        for attempt in range(4):
            req = urllib.request.Request(url, data=data, method=method)
            req.add_header("Authorization", f"Bearer {self._auth()}")
            req.add_header("Content-Type", "application/json")
            try:
                with urllib.request.urlopen(req, timeout=60) as res:
                    raw = res.read()
                    return res.status, (json.loads(raw) if raw else {})
            except urllib.error.HTTPError as e:
                raw = e.read()
                try:
                    payload = json.loads(raw)
                except ValueError:
                    payload = {"raw": raw.decode(errors="replace")[:500]}
                if e.code in (429, 500, 502, 503, 504) and attempt < 3:
                    time.sleep(10 * (attempt + 1))
                    continue
                return e.code, payload
            except urllib.error.URLError as e:
                if attempt < 3:
                    time.sleep(10 * (attempt + 1))
                    continue
                raise Fail(f"App Store Connect not reachable: {e.reason}") from None
        raise Fail("App Store Connect request failed repeatedly.")

    def get(self, path: str, params: dict | None = None) -> dict:
        status, payload = self.request("GET", path, params)
        if status == 401:
            raise Fail("API key rejected (401). Check ASC_KEY_ID, ASC_ISSUER_ID and ASC_PRIVATE_KEY.")
        if status == 403:
            raise Fail("API key lacks permission (403). It needs the role 'App Manager' or 'Admin'.")
        if status >= 400:
            raise Fail(f"GET {path} → {status}: {errors(payload)}")
        return payload


def errors(payload: dict) -> str:
    errs = payload.get("errors") or []
    return "; ".join(f"{e.get('title')}: {e.get('detail')}" for e in errs) or json.dumps(payload)[:300]


# --- Flow -----------------------------------------------------------------------------------

def find_app(api: Client, bundle_id: str) -> str:
    apps = api.get("/apps", {"filter[bundleId]": bundle_id, "fields[apps]": "bundleId,name"})["data"]
    apps = [a for a in apps if a["attributes"]["bundleId"] == bundle_id]
    if not apps:
        raise Fail(f"No app with bundle id {bundle_id} in App Store Connect.")
    print(f"App: {apps[0]['attributes']['name']} ({apps[0]['id']})")
    return apps[0]["id"]


def wait_for_build(api: Client, app_id: str, build: str, timeout_min: int) -> dict:
    deadline = time.time() + timeout_min * 60
    last = None
    while time.time() < deadline:
        data = api.get("/builds", {
            "filter[app]": app_id, "filter[version]": build,
            "fields[builds]": "version,processingState,expired,usesNonExemptEncryption",
        })["data"]
        state = data[0]["attributes"]["processingState"] if data else "NOT_VISIBLE_YET"
        if state != last:
            print(f"Build {build}: {state}", flush=True)
            last = state
        if state == "VALID":
            return data[0]
        if state in ("FAILED", "INVALID"):
            raise Fail(f"Apple rejected build {build} during processing ({state}). Details in the App Store Connect e-mail.")
        time.sleep(30)
    raise Fail(f"Build {build} was not processed within {timeout_min} min. It may still finish; check App Store Connect → TestFlight.")


def distribute(api: Client, app_id: str, build: dict, group_names: list[str]) -> list[str]:
    groups = api.get(f"/apps/{app_id}/betaGroups", {
        "fields[betaGroups]": "name,isInternalGroup,hasAccessToAllBuilds", "limit": "200",
    })["data"]
    by_name = {g["attributes"]["name"]: g for g in groups}
    internal = [g["attributes"]["name"] for g in groups if g["attributes"].get("isInternalGroup")]
    print("Internal groups: " + (", ".join(internal) or "none"))
    done = []
    targets = group_names or []
    if not targets:
        auto = [g["attributes"]["name"] for g in groups
                if g["attributes"].get("isInternalGroup") and g["attributes"].get("hasAccessToAllBuilds")]
        if auto:
            print("No TESTFLIGHT_GROUPS set; these internal groups receive every build automatically: " + ", ".join(auto))
        else:
            gh("warning", "No TESTFLIGHT_GROUPS set and no internal group has automatic distribution. "
               "Set the repository variable TESTFLIGHT_GROUPS or enable automatic distribution on the group.")
        return auto
    for name in targets:
        g = by_name.get(name)
        if g is None:
            raise Fail(f"TestFlight group '{name}' not found. Existing: {', '.join(by_name) or 'none'}.")
        if not g["attributes"].get("isInternalGroup"):
            gh("warning", f"Skipping '{name}': external groups need Beta App Review; this pipeline only distributes internally.")
            continue
        if g["attributes"].get("hasAccessToAllBuilds"):
            print(f"'{name}' has automatic distribution: build is already available.")
            done.append(name)
            continue
        status, payload = api.request("POST", f"/betaGroups/{g['id']}/relationships/builds",
                                      body={"data": [{"type": "builds", "id": build["id"]}]})
        if status in (200, 201, 204, 409):
            print(f"Added build to '{name}'.")
            done.append(name)
        else:
            raise Fail(f"Adding build to '{name}' failed ({status}): {errors(payload)}")
    return done


def self_test() -> None:
    """Offline: sign with a throwaway P-256 key and verify the JWS signature with openssl."""
    with tempfile.TemporaryDirectory() as d:
        key, pub = os.path.join(d, "k.pem"), os.path.join(d, "p.pem")
        subprocess.run(["openssl", "ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", key], check=True)
        subprocess.run(["openssl", "pkcs8", "-topk8", "-nocrypt", "-in", key, "-out", key + "8"], check=True)
        subprocess.run(["openssl", "ec", "-in", key, "-pubout", "-out", pub], check=True, capture_output=True)
        token = make_jwt("TESTKEY123", "issuer-uuid", open(key + "8").read())
        h, p, s = token.split(".")
        pad = lambda x: x + "=" * (-len(x) % 4)  # noqa: E731
        assert json.loads(base64.urlsafe_b64decode(pad(h))) == {"alg": "ES256", "kid": "TESTKEY123", "typ": "JWT"}
        claims = json.loads(base64.urlsafe_b64decode(pad(p)))
        assert claims["aud"] == "appstoreconnect-v1" and claims["exp"] - claims["iat"] <= 1200
        raw = base64.urlsafe_b64decode(pad(s))
        assert len(raw) == 64
        # raw r||s → DER, then verify with openssl.
        def der_int(b: bytes) -> bytes:
            b = b.lstrip(b"\0") or b"\0"
            if b[0] & 0x80:
                b = b"\0" + b
            return bytes([2, len(b)]) + b
        body = der_int(raw[:32]) + der_int(raw[32:])
        sig_path = os.path.join(d, "sig.der")
        open(sig_path, "wb").write(bytes([0x30, len(body)]) + body)
        res = subprocess.run(["openssl", "dgst", "-sha256", "-verify", pub, "-signature", sig_path],
                             input=f"{h}.{p}".encode(), capture_output=True)
        assert res.returncode == 0, res.stdout + res.stderr
    print("self-test OK: ES256 JWT signs and verifies")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bundle-id")
    ap.add_argument("--build")
    ap.add_argument("--groups", default="", help="comma-separated internal TestFlight group names")
    ap.add_argument("--timeout-min", type=int, default=45)
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()
    if args.self_test:
        self_test()
        return 0
    if not args.bundle_id or not args.build:
        ap.error("--bundle-id and --build are required")
    try:
        missing = [v for v in ("ASC_KEY_ID", "ASC_ISSUER_ID", "ASC_PRIVATE_KEY") if not os.environ.get(v)]
        if missing:
            raise Fail(f"Missing {', '.join(missing)} (GitHub environment 'testflight').")
        api = Client(os.environ["ASC_KEY_ID"], os.environ["ASC_ISSUER_ID"], os.environ["ASC_PRIVATE_KEY"])
        app_id = find_app(api, args.bundle_id)
        build = wait_for_build(api, app_id, args.build, args.timeout_min)
        if build["attributes"].get("usesNonExemptEncryption") is None:
            gh("warning", "Export compliance is unanswered; testers only see the build after it is answered "
               "(ITSAppUsesNonExemptEncryption in Info.plist normally answers it).")
        groups = [g.strip() for g in args.groups.split(",") if g.strip()]
        done = distribute(api, app_id, build, groups)
        msg = f"Build {args.build} is processed" + (f" and available to: {', '.join(done)}" if done else "")
        print("✓ " + msg)
        summary(f"✅ {msg}.")
        return 0
    except Fail as e:
        gh("error", str(e))
        summary(f"❌ {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
