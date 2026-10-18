# AP Console (frontend)

Saudi Cargo accounts payable automation UI — OpenUI5 / Fiori shell talking to the gateway (`:8000`) and agentic services (`:8001`).

## Run

```bash
cd frontend
npm install          # first time only
npm start            # UI5 CLI + livereload → usually http://localhost:8080
```

Open the URL printed by `@ui5/cli serve`. Ensure the backend gateway is up so upload / case list / document preview work.

## Demo flow

1. **Dashboard** — queue + KPI strip; processing cases show a mini pipeline.
2. **Upload** — drop an invoice; watch the full 5-step pipeline light Done / Working / Pending.
3. **Clear Desk (Review)** — PDF + Agent Results / Invoice Fields; live pipeline while agents run.
4. **Dock Decide** — Approve / Return / Reject on the review dock (approver profiles).

## Design branch note

`design/ap-console-v2` is a from-scratch **Runway** redesign (tokens, motion, IA) while keeping the UI5 runtime and CaseStore API contracts.

To compare with prior product UX:

```bash
git checkout product/ap-automation-platform   # previous pipeline UX work
git checkout design/ap-console-v2             # this redesign (based on main)
```
