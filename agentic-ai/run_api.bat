@echo off
REM Starts the AP approval workflow API for local development.
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Virtual environment not found. Run setup.bat first.
  exit /b 1
)
set PYTHONUTF8=1
set APP_ENV=development
set AUTH_MODE=dev
set AP_DATA_DIR=%CD%\runtime_data
".venv\Scripts\python.exe" -m uvicorn api.main:app --app-dir src --host 127.0.0.1 --port 8001 --reload
endlocal
