#!/bin/sh
# genesis — container entrypoint.
#
# The platform's secret store is Cerulean Vault (HashiCorp Vault, KV v2), and a
# `.env` value may be a `vault://<mount>/<path>#<key>` reference instead of a
# literal — the same grammar Cerulean, Zeus, Onyx, Atlas and Distro resolve. A
# reference is resolved here, before the server boots, so every consumer reads
# the plain value from `process.env` and no application code knows about
# references. (docs/stack.md: Genesis holds no long-lived secret at rest.)
#
# Session, OIDC and sibling-service credentials are resolved. Plain values are
# left alone; a reference that cannot be resolved aborts the container instead of
# booting with a literal `vault://` value that looks configured and is not.
#
# VAULT_* (see .env.example): VAULT_ADDR / VAULT_TOKEN (or VAULT_TOKEN_FILE) /
# VAULT_PREFIX / VAULT_NAMESPACE / VAULT_SKIP_VERIFY / VAULT_CACERT.
set -e

VAULT_KEYS="SESSION_SECRET OIDC_CLIENT_SECRET ZEUS_API_TOKEN CERULEAN_SERVICE_KEY SIGNARA_API_KEY MAGNATE_API_TOKEN ENTITLEMENTS_API_TOKEN OASIS_PROVISION_TOKEN"

# Always run the resolver: with no references it is a silent no-op, and the
# status is checked explicitly so an unresolvable reference fails the container
# rather than being masked by `eval` exiting 0 on an empty substitution.
# shellcheck disable=SC2086  # VAULT_KEYS is a space-separated key list for word splitting
VAULT_EXPORTS="$(node /app/scripts/vault-env.mjs $VAULT_KEYS)" || exit 1
if [ -n "$VAULT_EXPORTS" ]; then
  eval "$VAULT_EXPORTS"
fi

# Next's standalone server binds to $HOSTNAME, which compose may set to the
# public name (not a local interface) — that makes listen() fail with
# EADDRNOTAVAIL. Pin it to 0.0.0.0 so the server listens on every interface.
export HOSTNAME=0.0.0.0
exec "$@"
