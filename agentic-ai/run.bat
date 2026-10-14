@echo off
REM Runs the email -> triage workflow. Extra arguments are passed through:
REM   run.bat                 latest email
REM   run.bat --top 5         latest 5 emails
REM   run.bat --dry-run       fetch only, no triage
REM Other modes:  run.bat --doc-ai [files]   (batch over invoice_samples\)
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Virtual environment not found. Run setup.bat first.
  exit /b 1
)
set PYTHONUTF8=1
if "%~1"=="--doc-ai" (
  ".venv\Scripts\python.exe" run_triage.py %*
) else (
  ".venv\Scripts\python.exe" run_workflow.py %*
)
echo.
echo Log table: output\run_log.csv   (open in Excel)
endlocal
