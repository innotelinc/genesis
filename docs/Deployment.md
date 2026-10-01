# Genesis — deployment

Genesis runs as one container on the estate's app host (i2), behind the Cerulean
edge, signing users in through Cerulean's Authentik. This page is the runbook:
the shape of the deployment, then the exact steps, then what is still manual.

## What it is

| Piece | Value |
|---|---|
| Host | **i2** (`192.168.1.52`, the incus host) |
| Container | `genesis`, Ubuntu 24.04, profiles `default` + `docker` |
| Address | **`192.168.1.66`** (static in the container; see *Manual* below) |
| Limits | `limits.cpu 2`, `limits.memory 2GiB`, `boot.autostart true` |
| Project | `/opt/genesis` (a clone of this repo on `main`) |
| App | `docker compose up -d` → container `genesis`, `0.0.0.0:3000` |
| Public name | `genesis.innotel.us` → `http://192.168.1.66:3000` (NPM proxy host #198) |
| TLS | the estate wildcard `*.innotel.us` (NPM certificate #34) |
| Identity | Authentik application `genesis`, provider pk 49, group `genesis-admins` |

Genesis is a single service: it owns its SQLite volume (`genesis_genesis-data`)
and reaches the rest of the stack over the network. Nothing else depends on it,
so its host can change without touching anything else.

That volume is one directory with two children, and `GENESIS_DATA_DIR` is what
names it: `genesis.db` (the record) and `filings/` (the signed Form SS-4s a
filing was made from). Both ask `src/lib/paths.ts` for it, so a backup, a mount
or a restore moves them together — the reasoning is in that file, and it exists
because the database used to ignore the setting entirely and always open
`process.cwd()/data`, which coincided with the volume here and would not have
anywhere else.

## Backing up, and rehearsing the restore

The record and the signed copies are **one piece of evidence**: the record says an EIN was
filed, and the signed Form SS-4 is what proves it. So they are taken together, by one
command:

```bash
make backup            # a consistent snapshot, through SQLite's own VACUUM INTO
make backups           # what is there, and which snapshot is oldest
make rehearse-restore  # snapshot → restore into a scratch directory → verify
```

`scripts/backup-rehearsal.mjs` is the whole of it, and three things about it are deliberate.

The snapshot is taken by **`VACUUM INTO`**, not by copying `genesis.db`. Copying the file
of a database that is being written — which is what the portal is doing whenever somebody
is signed in — can capture a torn page or a WAL that was never folded in, and that is a
failure nobody discovers until the day it matters. SQLite writes the copy through its own
machinery, so it is consistent however busy the deployment is.

**The rehearsal restores into a scratch directory** and never touches the live one. It
takes a fresh snapshot, unpacks it under the system's temporary directory, and asks the
restored copy the questions that matter: did the schema arrive, do the row counts match the
*source* (a snapshot that silently dropped rows is the failure this exists to catch), and is
every signed copy the record claims still on disk and still a PDF. It asserts — a
non-zero exit on any failure, so a timer can run it — rather than printing "OK" for nobody
to read.

The default backup root is `$GENESIS_BACKUP_DIR`, then **`<data>/../backups`** — *beside*
the data directory, not inside it. A backup that lives on the volume it is backing up dies
with that volume, which is the one thing a backup must not do.

**What a rehearsal does not prove.** It does not prove the *gateway* side of anything: the
Zeus number, the Cerulean zone, the Oasis mailbox and the Magnate subscription are the
platform's records, and restoring them is the platform's job (`scripts/check-integrations.mjs`
is the reachability probe). It also does not re-verify a filing at the IRS — it proves the
signed copy is readable, not that the fax arrived.

## Where the image comes from

CI publishes the image on every merge to `main`: `latest` and an immutable
`:<short-sha>` tag (`ghcr.io/innotelinc/genesis`). A host pins the SHA with
`GENESIS_IMAGE_TAG`, so what runs is a reviewed commit and a rollback is a tag
change:

```bash
# in the host's .env — the short SHA CI pushed
GENESIS_IMAGE_TAG=<short-sha>
# then, on the container
docker compose pull && docker compose up -d --no-build
```

A host that cannot pull (or a first deployment before the package is public) can
build locally and carry the image over — the build wants ~3 GB of heap, which is
more than a memory-tight host has, so build it where there is headroom:

```bash
docker build -t ghcr.io/innotelinc/genesis:latest 1-primary/genesis
docker save ghcr.io/innotelinc/genesis:latest | gzip -1 | \
  ssh root@192.168.1.52 "incus exec genesis -- docker load"
```

## Provisioning, from scratch

The incus hosts are reached over SSH as `root` with the estate's incus password
(never in a repo file; see `ontrak-sync/scripts/setup.sh` for the reference).
`sshpass -e ssh root@192.168.1.52` then `incus …`.

1. **Container.**
   ```bash
   incus launch images:ubuntu/24.04 genesis --profile default --profile docker
   incus config set genesis limits.cpu=2
   incus config set genesis limits.memory=2GiB
   incus config set genesis boot.autostart=true
   ```
2. **Static address** — `/etc/netplan/99-static.yaml` with
   `192.168.1.66/24`, `dhcp4: false`, DNS `192.168.1.71`/`1.1.1.1`, default via
   `192.168.1.1`, then `netplan apply`. (The router hands out DHCP in
   `192.168.1.2–209`, so this must also be **reserved** in the router UI — see
   *Manual*.)
3. **Docker.** `apt-get update && apt-get install -y docker.io docker-compose-v2 git`.
4. **Source + image.** `git clone https://github.com/innotelinc/genesis.git /opt/genesis`,
   then carry the image over as above.
5. **`.env`** — see `.env.example`. On a production host the two secrets
   (`SESSION_SECRET`, `OIDC_CLIENT_SECRET`) are **Cerulean Vault references**,
   not literals: the container's `.env` carries
   `vault://cerulean/genesis#<KEY>` and `docker-entrypoint.sh` resolves them
   before the server boots (see *Secrets* below).
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
   NPM_CERT_ID=34 NPM_FORWARD_HOST=192.168.1.66 python3 scripts/npm-proxy-hosts.py
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

- **Router DHCP reservation for `192.168.1.66`.** The address is static inside
  the container, but the router's pool (`192.168.1.2–209`) can still hand it to
  another device until it is reserved. The reservation is UI-only
  (**Advanced → Setup → LAN Setup → Address Reservation**); the router's REST
  login is not scriptable (see `1-primary/cerulean/docs/router.md`). Note the
  move from i3: the container now runs on i2, so any reservation for the old
  `.65` should be removed as well.
- **Router DHCP reservation** — see above.

## Secrets (Cerulean Vault)

Genesis holds two secrets, and neither is written into the container's `.env` as
plaintext on a deployed host:

| Key | What it is |
| --- | --- |
| `SESSION_SECRET` | signs the session cookie |
| `OIDC_CLIENT_SECRET` | the Authentik client secret |

They live at `cerulean/genesis` in Cerulean Vault (KV v2), and the container's
`.env` carries references:

```
SESSION_SECRET=vault://cerulean/genesis#SESSION_SECRET
OIDC_CLIENT_SECRET=vault://cerulean/genesis#OIDC_CLIENT_SECRET
```

`docker-entrypoint.sh` runs `scripts/vault-env.mjs` (same grammar as Cerulean,
Zeus, Onyx, Atlas and Distro) before the server starts, and **aborts the
container** if a reference cannot be resolved — a literal `vault://` value never
reaches the app.

Genesis reads the store with a path-scoped `genesis` token (policy
`cerulean/data/genesis`), not the mount-wide one. Cerulean mints it from
`VAULT_PRODUCT_TOKENS` and writes `/vault/token/genesis.token`; a copy lives at
`data/vault/token/genesis.token` in this repo (and on the host). No `genesis`
entry in `VAULT_PRODUCT_TOKENS` means no token, and the reference cannot resolve.

Seed or rotate the path with the estate's migrator:

```bash
VAULT_ADDR=http://192.168.1.71:8200 \
VAULT_TOKEN="$(cat data/vault/token/cerulean.token)" \
VAULT_PREFIX=cerulean VAULT_PATH=genesis \
  python3 ../ips/scripts/vault-migrate.py --from-env-file .env \
    --keys SESSION_SECRET,OIDC_CLIENT_SECRET
```

Check every reference in the estate actually resolves with
`ips/scripts/check-vault-refs.py`; from a host that cannot reach Vault it reports
the references it could not check and passes.
