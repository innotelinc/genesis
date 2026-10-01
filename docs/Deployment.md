# Genesis — deployment

Genesis runs as one container on the estate's light host (i3), behind the
Cerulean edge, signing users in through Cerulean's Authentik. This page is the
runbook: the shape of the deployment, then the exact steps, then what is still
manual.

## What it is

| Piece | Value |
|---|---|
| Host | **i3** (`192.168.1.53`, the incus host) |
| Container | `genesis`, Ubuntu 24.04, profiles `default` + `docker` |
| Address | **`192.168.1.65`** (static in the container; see *Manual* below) |
| Limits | `limits.cpu 2`, `limits.memory 2GiB`, `boot.autostart true` |
| Project | `/opt/genesis` (a clone of this repo on `main`) |
| App | `docker compose up -d` → container `genesis`, `0.0.0.0:3000` |
| Public name | `genesis.innotel.us` → `http://192.168.1.65:3000` (NPM proxy host #198) |
| TLS | the estate wildcard `*.innotel.us` (NPM certificate #34) |
| Identity | Authentik application `genesis`, provider pk 49, group `genesis-admins` |

Genesis is a single service: it owns its SQLite volume (`genesis_genesis-data`)
and reaches the rest of the stack over the network. Nothing else depends on it,
so its host can change without touching anything else.

## Why the image is built off-host

i3 is memory-tight (5.4 GiB total, ~2 GiB free) and a Next.js production build
wants ~3 GB of heap. The image is therefore built on the development host and
carried to the container — the same reason Magnate's image was carried over as
an artifact rather than rebuilt on i3:

```bash
# on a host with headroom and Docker
docker build -t ghcr.io/innotelinc/genesis:latest 1-primary/genesis
docker save ghcr.io/innotelinc/genesis:latest | gzip -1 | \
  ssh root@192.168.1.53 "incus exec genesis -- docker load"
```

Publishing the image to GHCR from CI (so this step disappears) is on the v1.0
roadmap; today `ghcr.io/innotelinc/genesis:latest` is what the compose file names,
and `docker compose up -d --no-build` uses whatever was loaded.

## Provisioning, from scratch

The incus hosts are reached over SSH as `root` with the estate's incus password
(never in a repo file; see `ontrak-sync/scripts/setup.sh` for the reference).
`sshpass -e ssh root@192.168.1.53` then `incus …`.

1. **Container.**
   ```bash
   incus launch images:ubuntu/24.04 genesis --profile default --profile docker
   incus config set genesis limits.cpu=2
   incus config set genesis limits.memory=2GiB
   incus config set genesis boot.autostart=true
   ```
2. **Static address** — `/etc/netplan/99-static.yaml` with
   `192.168.1.65/24`, `dhcp4: false`, DNS `192.168.1.71`/`1.1.1.1`, default via
   `192.168.1.1`, then `netplan apply`. (The router hands out DHCP in
   `192.168.1.2–209`, so this must also be **reserved** in the router UI — see
   *Manual*.)
3. **Docker.** `apt-get update && apt-get install -y docker.io docker-compose-v2 git`.
4. **Source + image.** `git clone https://github.com/innotelinc/genesis.git /opt/genesis`,
   then carry the image over as above.
5. **`.env`** — see `.env.example`. On a production host the values that are
   secret (`SESSION_SECRET`, `OIDC_CLIENT_SECRET`) are written straight into the
   container's `.env` today; moving them to `vault://` references is on the
   roadmap.
6. **Authentik application.**
   ```bash
   cd 1-primary/cerulean
   AUTHENTIK_GENESIS_CLIENT_ID=genesis \
   AUTHENTIK_GENESIS_CLIENT_SECRET="$(openssl rand -hex 32)" \
   AUTHENTIK_GENESIS_REDIRECT_URI="https://genesis.innotel.us/api/auth/callback" \
   AUTHENTIK_GENESIS_GROUPS="genesis-admins" \
   python3 scripts/authentik-setup.py genesis
   ```
   Put the same secret in the container's `OIDC_CLIENT_SECRET`.
7. **Bring it up.** `cd /opt/genesis && docker compose up -d --no-build`.
8. **Publish the name.**
   ```bash
   NPM_CERT_ID=34 NPM_FORWARD_HOST=192.168.1.65 python3 scripts/npm-proxy-hosts.py
   ```
   That upserts the NPM proxy host and (when `TECHNITIUM_URL`/`TECHNITIUM_TOKEN`
   are set) the CNAME. Technitium's API is published on the Cerulean host's
   bridge (`172.17.0.1:5380`), not its LAN address, so from off that host run it
   inside the `proxy` container — or add the record by hand:
   ```
   genesis.innotel.us  CNAME  innotel.us     (zone innotel.us, TTL 300)
   ```

## Verify

```bash
curl -s --resolve genesis.innotel.us:443:192.168.1.71 https://genesis.innotel.us/api/health
# {"status":"ok","service":"genesis","classification":"BusinessOps","steps":13, … }

curl -s -o /dev/null -D - --resolve genesis.innotel.us:443:192.168.1.71 \
  https://genesis.innotel.us/api/auth/login
# HTTP/2 307 → https://auth.cerulean.innotel.us/application/o/authorize/?client_id=genesis&…
```

The health body is the policy split — `assistedProviders: ["irs"]` is how a
running container proves the assisted-EIN change is what shipped.

## Manual, and not yet done

- **Router DHCP reservation for `192.168.1.65`.** The address is static inside
  the container, but the router's pool (`192.168.1.2–209`) can still hand it to
  another device until it is reserved. The reservation is UI-only
  (**Advanced → Setup → LAN Setup → Address Reservation**); the router's REST
  login is not scriptable (see `1-primary/cerulean/docs/router.md`).
- **SecretOps.** `SESSION_SECRET` and `OIDC_CLIENT_SECRET` live in the
  container's `.env`. The estate's target is `vault://cerulean/genesis#…`
  references resolved at startup.
- **Image publishing.** CI builds and boots the image but does not push it;
  `ghcr.io/innotelinc/genesis` does not exist yet.
