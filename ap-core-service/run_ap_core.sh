
#!/usr/bin/env bash
set -e

# Always run from this script's directory
cd "$(dirname "$0")"

echo "=== Starting AP Core ==="

# Create virtual environment if missing
if [ ! -f ".venv/Scripts/python.exe" ]; then
    echo "Creating Python 3.13 virtual environment..."
    py -3.13 -m venv .venv
fi

# Activate environment
source .venv/Scripts/activate

# Install dependencies
echo "Installing/checking dependencies..."
python -m pip install -r requirements.txt

# Load environment variables from .env
if [ -f ".env" ]; then
    set -a
    source .env
    set +a
else
    echo "ERROR: .env file not found."
    exit 1
fi

# Prepare database directory
mkdir -p "$(dirname "$AP_CORE_DB_PATH")"

# Start server
echo "AP Core starting at http://127.0.0.1:8002"
echo "API docs: http://127.0.0.1:8002/docs"

exec python -m uvicorn ap_core.main:app \
    --app-dir . \
    --host 127.0.0.1 \
    --port 8002
