@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Virtual environment not found. Run setup.bat first.
  exit /b 1
)
set PYTHONUTF8=1
".venv\Scripts\python.exe" -m pytest -q %*
endlocal
