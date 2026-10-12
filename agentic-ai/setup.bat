@echo off
REM One-time setup: creates .venv, installs dependencies, creates config files from templates.
setlocal
cd /d "%~dp0"

set "PY="
for %%V in (3.12 3.13 3.11 3.14) do (
  if not defined PY (
    py -%%V -c "import sys" >nul 2>&1 && set "PY=py -%%V"
  )
)
if not defined PY (
  python --version >nul 2>&1 && set "PY=python"
)
if not defined PY (
  echo ERROR: Python 3.11 or newer was not found. Install it from https://www.python.org/downloads/
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo Creating virtual environment with: %PY%
  %PY% -m venv .venv
  if errorlevel 1 (
    echo ERROR: could not create the virtual environment.
    exit /b 1
  )
)

echo Installing dependencies...
".venv\Scripts\python.exe" -m pip install --upgrade pip >nul
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
  echo ERROR: dependency install failed.
  exit /b 1
)

if not exist "output" mkdir output
if not exist "invoice_samples" mkdir invoice_samples

set "NEED_EDIT="
if not exist "config\.env" (
  copy "config\.env.example" "config\.env" >nul
  set "NEED_EDIT=1"
  echo Created config\.env
)
if not exist "config\ai_core_cred.json" (
  copy "config\ai_core_cred.json.example" "config\ai_core_cred.json" >nul
  set "NEED_EDIT=1"
  echo Created config\ai_core_cred.json
)
if not exist "config\sap_credentials.json" (
  copy "config\sap_credentials.json.example" "config\sap_credentials.json" >nul
  set "NEED_EDIT=1"
  echo Created config\sap_credentials.json
)

echo.
echo Setup complete.
if defined NEED_EDIT (
  echo Next: fill in the config files listed above ^(they are git-ignored, never commit them^).
)
echo Then run:  run.bat            ^(latest email -^> AI Core -^> Document AI -^> triage^)
echo            run_tests.bat      ^(unit tests, no network needed^)
endlocal
