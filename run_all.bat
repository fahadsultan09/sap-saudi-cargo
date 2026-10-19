@echo off
rem Starts the whole AP Console stack: Keycloak (Docker) and one window per service.
rem Close a service by closing its window; stop Keycloak with: docker compose -f infra\docker-compose.yml down
setlocal
cd /d "%~dp0"
set "PYTHONUTF8=1"

docker info >nul 2>&1 || (echo Docker Desktop is not running. Start it and run this script again. & exit /b 1)
for %%F in (infra\.env gateway\.env ap-core-service\.env agentic-ai\config\.env) do (
  if not exist "%%F" (echo Missing %%F - copy it from its .env.example and fill it in. & exit /b 1)
)

echo Starting Keycloak (sign-in) on http://localhost:8180 ...
docker compose -f infra\docker-compose.yml --env-file infra\.env up -d || exit /b 1

start "AP Core :8002" /D "%~dp0ap-core-service" cmd /k .venv\Scripts\python.exe -m uvicorn ap_core.main:app --app-dir . --host 127.0.0.1 --port 8002 --env-file .env
start "Agentic AI :8001" /D "%~dp0agentic-ai" cmd /k .venv\Scripts\python.exe -m uvicorn api.main:app --app-dir src --host 127.0.0.1 --port 8001
rem The worker takes queued invoices from AP Core and sends them to the agents; without it uploads stay queued.
start "Worker" /D "%~dp0ap-core-service" cmd /k .venv\Scripts\python.exe worker.py
start "Gateway :8000" /D "%~dp0gateway" cmd /k .venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
start "Frontend :8080" /D "%~dp0frontend" cmd /k npm start

echo.
echo All services are starting in their own windows. Open http://localhost:8000 (not 8080).
endlocal
