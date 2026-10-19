@echo off
setlocal
cd /d "%~dp0"
echo === Starting Agentic AI API ===
where py >nul 2>nul || (echo ERROR: Windows Python launcher py was not found.& exit /b 1)
if not exist ".venv\Scripts\python.exe" (
  echo Creating virtual environment with Python 3.13...
  py -3.13 -m venv .venv || exit /b 1
)
call .venv\Scripts\activate.bat || exit /b 1
python -m pip install -r requirements.txt || exit /b 1
if not exist "config\.env" (
  if exist "config\.env.example" (
    copy "config\.env.example" "config\.env" >nul
    echo Created config\.env from config\.env.example in local mock mode.
  ) else (
    echo ERROR: config\.env.example is missing.
    exit /b 1
  )
)
if not exist "runtime_data\uploads" mkdir "runtime_data\uploads"
echo Agentic AI starting at http://127.0.0.1:8001
echo API docs: http://127.0.0.1:8001/docs
echo Health: http://127.0.0.1:8001/health
python -m uvicorn api.main:app --app-dir src --host 127.0.0.1 --port 8001 --reload
