#!/usr/bin/env bash
# Restart agentic-ai on :8001 in SAP mode (uses config/.env).
# Run this in Apple Terminal (outside Cursor) so HTTP_PROXY is not injected.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="$ROOT/.venv/bin/python"
ENV_FILE="$ROOT/config/.env"
LOG="${TMPDIR:-/tmp}/agentic-ai-8001.log"

# Ensure SAP flags (does not touch secrets)
python3 - <<PY
from pathlib import Path
p = Path("$ENV_FILE")
text = p.read_text()
for key, val in (("AGENT_MODE", "sap"), ("SAP_PROCESSING_ENABLED", "true")):
    lines = text.splitlines()
    found = False
    for i, line in enumerate(lines):
        if line.startswith(key + "="):
            lines[i] = f"{key}={val}"
            found = True
            break
    if not found:
        lines.append(f"{key}={val}")
    text = "\n".join(lines) + "\n"
    print(f"Set {key}={val}")
p.write_text(text)
PY

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
