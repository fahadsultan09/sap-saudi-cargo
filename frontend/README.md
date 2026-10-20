# Saudi Cargo AP Console (demo UI)

Calm, plain-language invoice desk. Talks to the gateway on `:8000` (which proxies the agentic API on `:8001`).

## Run

```bash
# Terminal 1 — agentic API
cd agentic-ai && .venv/bin/python -m uvicorn api.main:app --app-dir src --host 127.0.0.1 --port 8001

# Terminal 2 — gateway
cd backend && .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# Terminal 3 — UI
cd frontend && npm install && npm start
```

Open **http://127.0.0.1:8080**

## Demo path

1. **Home** — see what needs attention; click **Upload invoice**
2. **Upload** — drop a PDF from `samples/invoices/`; watch the process light up in plain English
3. **Review** — check PDF + fields; switch user to **Sara · Approver** → **Approve** / **Ask again**

Legacy OpenUI5 sources are archived under `_legacy-ui5/` (not used by `npm start`).
