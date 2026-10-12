#!/usr/bin/env bash
# Local dev launcher for the transaction API. Reads passwords from services/.env.
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a
export DATABASE_URL="postgres://sajada_api:${SAJADA_API_PASSWORD}@127.0.0.1:5433/sajada"
# OIDC placeholders: replace with a real issuer (e.g. a Keycloak realm) to call authenticated endpoints.
export OIDC_ISSUER="${OIDC_ISSUER:-http://127.0.0.1:8085/realms/sajada}"
export OIDC_JWKS_URL="${OIDC_JWKS_URL:-$OIDC_ISSUER/protocol/openid-connect/certs}"
export OIDC_AUDIENCE="${OIDC_AUDIENCE:-sajada-api}"
export PORT="${PORT:-8090}"
exec node transaction/server.mjs
