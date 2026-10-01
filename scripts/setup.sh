#!/usr/bin/env bash
# genesis — one-shot bootstrap: attribution guard hooks, .env, and the secrets a
# local run needs. Idempotent: re-running never overwrites an existing value.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> genesis bootstrap"

# Install the attribution guard hooks locally (the CI job also enforces them).
if [ -d .githooks ]; then
  git config core.hooksPath .githooks 2>/dev/null || true
  echo "==> attribution guard hooks installed (.githooks)"
fi

if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    echo "==> .env created from .env.example — fill in the deployment-specific values"
  fi
fi

# Generate SESSION_SECRET if it is still empty. The session cookie is only as
# strong as this value; a placeholder must never survive into a deployment.
if [ -f .env ] && command -v openssl >/dev/null 2>&1; then
  if grep -qE '^SESSION_SECRET=(|change-me.*)$' .env; then
    secret="$(openssl rand -base64 32)"
    if grep -qE '^SESSION_SECRET=' .env; then
      # In-place edit without a temp file losing permissions.
      sed -i.bak "s|^SESSION_SECRET=.*|SESSION_SECRET=${secret}|" .env && rm -f .env.bak
    else
      printf '\nSESSION_SECRET=%s\n' "$secret" >> .env
    fi
    echo "==> SESSION_SECRET generated"
  fi
fi

if [ "${1:-}" != "--no-install" ] && [ ! -d node_modules ]; then
  echo "==> installing dependencies (npm install)"
  npm install --no-audit --no-fund
fi

cat <<'NEXT'

==> done. Next:
    1. Review .env — OIDC_*, CERULEAN_*, ZEUS_*, OASIS_* are the integrations.
    2. For local use without Authentik: GENESIS_DEV_AUTH=1 npm run dev
    3. npm run seed   # a demo client + business so the board has something in it
NEXT
