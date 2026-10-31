#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
docker compose version >/dev/null
if [ ! -f deploy/.env ]; then
  : "${SEED_ADMIN_PASSWORD:?Set SEED_ADMIN_PASSWORD for the demo accounts}"
  docker run --rm --user "$(id -u):$(id -g)" -e SEED_ADMIN_PASSWORD -v "$PWD:/work" -w /work node:24-bookworm-slim node deploy/configure.mjs
fi
docker compose --env-file deploy/.env -f deploy/compose.yml up -d --build --wait --wait-timeout 900
printf '\nCRM ready. Open http://localhost:3000 (or WEB_PORT configured in deploy/.env).\n'
