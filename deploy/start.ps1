$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
docker compose version
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop with Compose v2 is required' }
if (-not (Test-Path 'deploy/.env')) {
  if (-not $env:SEED_ADMIN_PASSWORD) { throw 'Set SEED_ADMIN_PASSWORD for the demo accounts' }
  docker run --rm -e SEED_ADMIN_PASSWORD -v "${PWD}:/work" -w /work node:24-bookworm-slim node deploy/configure.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Configuration failed' }
}
docker compose --env-file deploy/.env -f deploy/compose.yml up -d --build --wait --wait-timeout 900
if ($LASTEXITCODE -ne 0) { throw 'Startup failed. Read deployment guide and container logs.' }
Write-Host 'CRM ready. Open http://localhost:3000 (or configured WEB_PORT).'
