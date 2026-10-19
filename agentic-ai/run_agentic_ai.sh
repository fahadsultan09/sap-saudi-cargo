#!/usr/bin/env bash
set -euo pipefail

# Run from the directory containing this script.
cd "$(dirname "$0")"

echo "=== Starting Agentic AI API ==="

# This project requires Python 3.13+; avoid the legacy Python 2.7 `python` command.
if ! command -v py >/dev/null 2>&1; then
  echo "ERROR: Windows Python launcher 'py' was not found. Install Python 3.13 and enable the launcher."
  exit 1
fi

if [ ! -f ".venv/Scripts/python.exe" ]; then
  echo "Creating virtual environment with Python 3.13..."
  py -3.13 -m venv .venv
fi

source .venv/Scripts/activate

if [ ! -f "requirements.txt" ]; then
  echo "ERROR: requirements.txt is missing. Run this script from the extracted project root."
  exit 1
fi

echo "Installing/checking dependencies..."
python -m pip install -r requirements.txt

if [ ! -f "config/.env" ]; then
  if [ -f "config/.env.example" ]; then
    cp "config/.env.example" "config/.env"
    echo "Created config/.env from config/.env.example (local mock mode)."
  else
    echo "ERROR: config/.env.example is missing."
    exit 1
  fi
fi

mkdir -p runtime_data/uploads

echo "Agentic AI starting at http://127.0.0.1:8001"
echo "API docs: http://127.0.0.1:8001/docs"
echo "Health: http://127.0.0.1:8001/health"
echo "Mode: local configuration in config/.env"

exec python -m uvicorn api.main:app --app-dir src --host 127.0.0.1 --port 8001 --reload
