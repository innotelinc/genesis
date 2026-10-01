#!/usr/bin/env python3
"""npm-proxy-hosts.py — publish Genesis's public name at the estate's edge.

Idempotent: the proxy host is created when missing and updated when it drifts,
and the DNS record is added only when absent. Safe to run on a fresh deployment
and on every re-run.

Genesis never talks to BIND or the NPM API at runtime (conformity standard §5 —
identity, DNS, TLS and the proxy belong to Cerulean). This script is not that
runtime path: it is the *operator's* one-shot, run once when Genesis is first put
on a host, so the same change is reviewable and repeatable instead of a series of
UI clicks. The client-zone names Genesis provisions for its *customers* use the
Cerulean service bridge (`CERULEAN_SERVICE_KEY`), not this.

WHAT IT CREATES
---------------
    <GENESIS_DOMAIN>            CNAME to the estate apex, in the Technitium zone
    <GENESIS_DOMAIN>            NPM proxy host -> http://<NPM_FORWARD_HOST>:<GENESIS_PORT>

TLS is the estate's existing wildcard certificate (`*.innotel.us`), which already
covers the name — so this attaches the certificate NPM holds rather than issuing
a new one. `NPM_CERT_ID` names it; when unset the script finds the certificate
whose SANs cover the domain.

Required (in `.env` or the environment):
    NPM_API_URL        e.g. http://192.168.1.71:81
    NPM_EMAIL          NPM login
    NPM_PASSWORD       NPM password
    NPM_FORWARD_HOST   the host Genesis runs on, by LAN address (never loopback —
                       NPM upstreams reach the container from outside it)
    GENESIS_PORT       the host port Genesis publishes (default 3000)

Optional:
    GENESIS_DOMAIN     the public name (default: BASE_DOMAIN, else genesis.innotel.us)
    NPM_CERT_ID        NPM certificate id to attach (default: match by SAN)
    TECHNITIUM_URL / TECHNITIUM_TOKEN
                       when both are set, the CNAME is created; when unset the
                       record is left to Cerulean's DNS UI and the script says so
    CERULEAN_ZONE      the zone the CNAME lives in (default: innotel.us)

Only stdlib — run with:  python3 scripts/npm-proxy-hosts.py
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


def env(key: str, default: str = "") -> str:
    return os.environ.get(key, default).strip()


def load_env_file(path: str) -> None:
    """Fill only unset keys — an exported value wins over the file."""
    if not os.path.isfile(path):
        return
    with open(path, encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip("\"'")
            if key and key not in os.environ:
                os.environ[key] = value


class Npm:
    def __init__(self, api_url: str, email: str, password: str) -> None:
        self.api_url = api_url.rstrip("/")
        self.email, self.password = email, password
        self.token = ""

    def _request(self, method: str, path: str, body=None):
        if not self.token:
            self._login()
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(f"{self.api_url}/api{path}", data=data, method=method)
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", f"Bearer {self.token}")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read().decode()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as err:
            detail = err.read().decode(errors="replace") if err.fp else ""
            raise SystemExit(f"error: NPM {method} {path} failed (HTTP {err.code}): {detail}")
        except urllib.error.URLError as err:
            raise SystemExit(f"error: cannot reach NPM at {self.api_url} ({err.reason})")

    def _login(self) -> None:
        req = urllib.request.Request(
            f"{self.api_url}/api/tokens",
            data=json.dumps({"identity": self.email, "secret": self.password}).encode(),
            method="POST",
        )
        req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                self.token = (json.loads(resp.read().decode()) or {}).get("token", "")
        except urllib.error.HTTPError as err:
            detail = err.read().decode(errors="replace") if err.fp else ""
            raise SystemExit(f"error: NPM login failed (HTTP {err.code}): {detail} — "
                             "check NPM_EMAIL/NPM_PASSWORD")
        if not self.token:
            raise SystemExit("error: NPM returned no token — check NPM_EMAIL/NPM_PASSWORD")


def covers(cert: dict, domain: str) -> bool:
    names = {str(n).lower() for n in (cert.get("domain_names") or [])}
    return domain in names or f"*.{domain.split('.', 1)[1]}" in names


def find_certificate(npm: Npm, domain: str, wanted: str):
    """The certificate to attach, or None.

    NPM's API stores only a certificate's *primary* name in `domain_names` — the
    SANs (where the estate's `*.innotel.us` wildcard actually lives) are not
    exposed, so this cannot reliably recognise a covering wildcard by looking. It
    therefore matches only an exact/wildcard name, and the runbook sets
    `NPM_CERT_ID` for the estate's wildcard. That is deliberate: the first
    version guessed, failed to see the wildcard, and rewrote a working host with
    `certificate_id: 0` — losing its TLS. A certificate this cannot identify is a
    reason to stop, not to publish a host without one.
    """
    certs = npm._request("GET", "/nginx/certificates") or []
    if wanted:
        found = next((c for c in certs if str(c.get("id")) == wanted), None)
        if not found:
            raise SystemExit(f"error: NPM has no certificate #{wanted}")
        return found
    return next((c for c in certs if covers(c, domain)), None)


def add_cname(domain: str, target: str, zone: str) -> bool:
    """Create the CNAME in Technitium, or report that DNS is someone else's job."""
    base = env("TECHNITIUM_URL").rstrip("/")
    token = env("TECHNITIUM_TOKEN")
    if not base or not token:
        print(f"  · DNS: TECHNITIUM_URL/TECHNITIUM_TOKEN unset — add the record by "
              f"hand: {domain} CNAME {target} (zone {zone})")
        return False
    params = urllib.parse.urlencode({
        "domain": domain, "zone": zone, "type": "CNAME", "ttl": "300", "cname": target,
    })
    req = urllib.request.Request(f"{base}/api/zones/records/add?{params}")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
        print(f"  ✓ DNS created {domain} CNAME {target}")
        return data.get("status") in ("ok", None)
    except urllib.error.HTTPError as err:
        body = err.read().decode(errors="replace") if err.fp else ""
        if "already exists" in body.lower() or "duplicate" in body.lower():
            print(f"  ✓ DNS {domain} CNAME {target} already present")
            return True
        print(f"  ! DNS add failed (HTTP {err.code}): {body}", file=sys.stderr)
        return False
    except urllib.error.URLError as err:
        # Technitium's HTTP API is published on the Cerulean host's bridge, not
        # its LAN address, so it is unreachable from off that host — a normal
        # run from a workstation, and not a reason to fail the proxy host.
        print(f"  ! DNS: cannot reach {base} ({err.reason}) — add the record by hand: "
              f"{domain} CNAME {target} (zone {zone})", file=sys.stderr)
        return False


def main() -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    for path in (os.path.join(here, "..", ".env"), ".env"):
        load_env_file(path)

    api_url = env("NPM_API_URL")
    email = env("NPM_EMAIL")
    password = env("NPM_PASSWORD")
    forward_host = env("NPM_FORWARD_HOST")
    port = int(env("GENESIS_PORT", "3000"))
    domain = env("GENESIS_DOMAIN") or env("BASE_DOMAIN") or "genesis.innotel.us"
    zone = env("CERULEAN_ZONE", "innotel.us")

    missing = [k for k, v in [
        ("NPM_API_URL", api_url), ("NPM_EMAIL", email), ("NPM_PASSWORD", password),
        ("NPM_FORWARD_HOST", forward_host),
    ] if not v]
    if missing:
        print(f"Genesis's public name needs: {', '.join(missing)}.\n"
              f"Serial publishing does nothing — set them in .env and re-run.",
              file=sys.stderr)
        return 2

    print(f"genesis — publishing {domain} via {api_url}")
    print(f"  upstream: http://{forward_host}:{port}")

    npm = Npm(api_url, email, password)

    hosts = npm._request("GET", "/nginx/proxy-hosts") or []
    existing = next((h for h in hosts if domain in (h.get("domain_names") or [])), None)

    cert = find_certificate(npm, domain, env("NPM_CERT_ID"))
    if cert:
        print(f"  ✓ TLS: certificate #{cert['id']} "
              f"({', '.join(cert.get('domain_names') or []) or 'SANs not listed'})")
    elif existing and existing.get("certificate_id"):
        # Re-running against a host that already has a working certificate must
        # not strip it just because this run could not name it.
        cert = {"id": existing["certificate_id"]}
        print(f"  ✓ TLS: keeping the host's existing certificate "
              f"#{cert['id']} (set NPM_CERT_ID to make this explicit)")
    else:
        print(f"error: no certificate at NPM covers {domain}. Set NPM_CERT_ID to "
              f"the estate wildcard (the SANs are not readable through the API), "
              f"or attach one from Cerulean first — refusing to publish the name "
              f"without TLS.", file=sys.stderr)
        return 1

    payload = {
        "domain_names": [domain],
        "forward_scheme": "http",
        "forward_host": forward_host,
        "forward_port": port,
        "certificate_id": cert["id"] if cert else 0,
        "ssl_forced": bool(cert),
        "http2_support": True,
        "block_exploits": True,
        "caching_enabled": False,
        "allow_websocket_upgrade": True,
        "access_list_id": "0",
        # No auth_request gate: identity is Authentik OIDC, applied by the app.
        "advanced_config": "",
        "meta": {"letsencrypt_agree": False, "dns_challenge": False},
    }

    if existing:
        npm._request("PUT", f"/nginx/proxy-hosts/{existing['id']}", payload)
        print(f"  ✓ proxy host #{existing['id']} updated → http://{forward_host}:{port}")
    else:
        created = npm._request("POST", "/nginx/proxy-hosts", payload)
        print(f"  ✓ proxy host #{created.get('id')} created → http://{forward_host}:{port}")

    add_cname(domain, zone, zone)

    print(f"\nDone. Verify from outside the container:\n"
          f"    curl -s https://{domain}/api/health")
    return 0


if __name__ == "__main__":
    sys.exit(main())
