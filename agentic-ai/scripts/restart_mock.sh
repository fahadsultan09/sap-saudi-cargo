#!/usr/bin/env bash
# Restart agentic-ai on :8001 in mock mode (uses config/.env).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="$ROOT/.venv/bin/python"
LOG="${TMPDIR:-/tmp}/agentic-ai-8001.log"

for p in $(lsof -tiTCP:8001 -sTCP:LISTEN 2>/dev/null || true); do
  echo "Stopping PID $p on :8001"
  kill "$p" 2>/dev/null || true
done
sleep 1
for p in $(lsof -tiTCP:8001 -sTCP:LISTEN 2>/dev/null || true); do
  kill -9 "$p" 2>/dev/null || true
done

unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy || true
export NO_PROXY=127.0.0.1,::1,localhost
export no_proxy="$NO_PROXY"

cd "$ROOT"
nohup "$PYTHON" -m uvicorn api.main:app --app-dir src --host 127.0.0.1 --port 8001 >"$LOG" 2>&1 &
echo "Started PID $! — log: $LOG"
sleep 2
curl -sS --noproxy '*' "http://127.0.0.1:8001/health"
echo
curl -sS --noproxy '*' -H "X-User-Id: demo" -H "X-User-Role: AP_PROCESSOR" \
  "http://127.0.0.1:8001/api/v1/agents" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("mode=", d.get("mode")); print([(a["name"], a["status"]) for a in d.get("agents",[])])'
