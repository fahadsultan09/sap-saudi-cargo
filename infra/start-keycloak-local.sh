#!/bin/zsh
set -euo pipefail
export PATH="/Applications/Docker.app/Contents/Resources/bin:${HOME}/.docker/bin:/usr/local/bin:${PATH}"
export DOCKER_HOST="unix://${HOME}/.docker/run/docker.sock"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
echo "Waiting for Docker daemon..."
for i in {1..60}; do
  if docker info >/dev/null 2>&1; then
    echo "Docker ready (attempt $i)"
    break
  fi
  echo "  not ready ($i); ensure Docker Desktop is open (not only the DMG)"
  sleep 5
  if [[ $i -eq 60 ]]; then echo "Docker daemon not ready"; exit 1; fi
done
[[ -f infra/.env ]] || cp infra/.env.example infra/.env
docker compose -f infra/docker-compose.yml up -d
echo "Waiting for Keycloak :8180..."
for i in {1..60}; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" --noproxy '*' --max-time 3 http://127.0.0.1:8180/ 2>/dev/null || echo 000)
  echo "  keycloak http=$code ($i)"
  if [[ "$code" != "000" && "$code" != "000000" ]]; then
    echo "Keycloak is up"
    docker compose -f infra/docker-compose.yml ps
    exit 0
  fi
  sleep 5
done
echo "Keycloak did not become ready"; exit 1
