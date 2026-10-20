# ClearDesk (demo UI)

World-class invoice desk for AP automation demos. Talks to the gateway on `:8000` (which proxies the agentic API on `:8001`).

## Run

```bash
# Terminal 1 — agentic API
cd agentic-ai && .venv/bin/python -m uvicorn api.main:app --app-dir src --host 127.0.0.1 --port 8001

# Terminal 2 — gateway
cd backend && .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# Terminal 3 — UI
cd frontend && npm install && npm start
```

Open **http://127.0.0.1:8080** (hard refresh after UI changes: Cmd+Shift+R).

## Demo path

1. **Home** — attention queue + agent runway; click **Upload invoice**
2. **Upload** — drop a PDF from `samples/invoices/`; watch agents light up on the command runway
3. **Review** — PDF + fields; switch user to **Sara · Approver** → **Approve** / **Ask again**

Legacy OpenUI5 sources are archived under `_legacy-ui5/` (not used by `npm start`).
