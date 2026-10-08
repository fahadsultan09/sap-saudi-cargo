# Testing in three stages

Import `postman/saudi-cargo-ap.postman_collection.json` into Postman. Collection variables (runtime_url, core_url, runtime_api_key, users) are already set.
Run a folder with the Postman Runner, or from a terminal: `npx newman run postman/saudi-cargo-ap.postman_collection.json --folder "<folder name>"`.

## Stage 0: unit tests (no servers)
    cd backend && python -m pytest -q          # 39 passed
    cd agent-runtime && python -m pytest -q    # 10 passed

## Stage 1: the agent alone (runtime + mock gateway, no backend)
Tests your model and prompt. The mock gateway returns canned data and prints every lookup the agent makes.
    # terminal 1
    cd agent-runtime
    uvicorn scripts.mock_gateway:app --port 8001
    # terminal 2 (.env: AP_CORE_URL=http://localhost:8001, RUNTIME_API_KEY=change-me, AGENT_MODE=stub)
    uvicorn agent_app.main:app --env-file .env --port 8100
Postman folder **1**. Start with `AGENT_MODE=stub` (all green), then switch to `AGENT_MODE=aicore` with your AICORE_* variables and run it again.
What to look at with the real model: terminal 1 shows the tool calls in order, the Postman console shows the full answer and trace.
Not checked here: the amount guard and the evidence check. Those live in the backend, so a stage 1 pass does not mean the backend will accept the answer.
If `final` is null, read `error` and `trace` in the response (schema failure, step limit, timeout, model error).

## Stage 2: backend + agent over HTTP
Stop the mock gateway. Restart the runtime pointing at the backend (`AP_CORE_URL=http://localhost:8000`). Backend `.env` as in `backend/.env.example`
(AGENT_MODE=remote, AGENT_RUNTIME_URL=http://localhost:8100, same RUNTIME_API_KEY, any TOOL_TOKEN_SECRET).
    cd backend && uvicorn app.main:app --env-file .env --port 8000 --reload
Delete `backend/ap.db` first for a clean run. Postman folders **2** (full flow: create, decide, confirm, approve, post, post again refused, reconcile, audit) and **3** (gateway security).
Check "agent answered, not the fallback". If it fails, open the Audit trail request and read the last MODEL_JUDGEMENT line. It says why the agent was discarded.
Folder **4** uploads a file: pick `samples/*.txt` in stub mode, `samples/*.pdf` with real Document AI.

## Stage 3: connect the SAPUI5 frontend
Only start once stage 2 is green. The frontend must:
1. Call `http://localhost:8000` with headers `X-User` and `X-Role` on every request (dev stub).
2. Upload with `FormData` (field name `file`) to `POST /api/v1/cases/upload`. Do not set Content-Type yourself.
3. Follow the status: EXTRACTED (Run checks), NEEDS_REVIEW (fix fields), AWAITING_CONFIRM, AWAITING_APPROVAL, READY_TO_POST, POSTED (Reconcile), CLOSED. WAITING_EXTERNAL and REJECTED are end states for now.
4. Expect `decide` to take longer when the agent runs (up to AGENT_TIMEOUT, default 60 s). Show a busy indicator.
5. Show `judgement.source`, `evidence` and `trace` so the person approving can see what the agent looked up.
6. Live updates: `new EventSource("http://localhost:8000/api/v1/stream?user=omar&role=approver")`.
7. Serve the app on port 8080 (CORS allows it by default, change `CORS_ORIGINS` for another port).
