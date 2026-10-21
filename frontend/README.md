# AP Console (frontend)

AP Automation accounts payable UI — OpenUI5 / Fiori shell served by the gateway (`:8000`), which signs users in with Keycloak and forwards `/api/v1` calls to AP Core (`:8002`).

## Run

```bash
cd frontend
npm install          # first time only
npm start            # UI5 CLI + livereload → usually http://localhost:8080
```

Open the URL printed by `@ui5/cli serve`. Ensure the gateway (`gateway/`) is up so upload / case list / document preview work.

## Demo flow

1. **Dashboard** — queue + KPI strip; processing cases show a mini pipeline.
2. **Upload** — drop an invoice; watch the full 5-step pipeline light Done / Working / Pending.
3. **Review** — open an invoice from the dashboard for its PDF, agent results and invoice fields; live pipeline while agents run. The former `#/desk` URL redirects to the dashboard.
4. **Dock Decide** — Approve / Return / Reject on the review dock (approver profiles).

## Processor review

AP processors open the existing review panel in **Full Data View**. **Split View** opens the data/PDF layout on demand, side by side at desktop widths of 1280px and above; smaller screens stack the panes. Issues are presented in the existing Issues to resolve list. The information icon to the left of each selected agent's status opens its scope and recorded findings. For **Finance Rules**, it shows recorded triage rules, run-time confidence thresholds, client-friendly findings, and results, plus separately timestamped AP Core checks. Older invoices without detailed triage snapshots are labeled accordingly. The processor toolbar offers **Mark as Reviewed** and **Re-run Extraction**. Manager decisions remain restricted to approver roles.

Failed checks and warnings block submission and approval in AP Core. **Mark as Reviewed** records the processor and displays **Awaiting Approval** while retaining the canonical `READY_FOR_APPROVAL` state. Re-extraction queues a new durable work item and requires the worker to be running. Restart AP Core, the worker, and the gateway after installing these changes.

The embedded processor preview uses locally packaged PDF.js inside the existing iframe/Blob document flow. `npm install` and `npm start` prepare the renderer assets automatically. Before building directly, run `node lib/preparePdfViewer.js`; include the generated `vendor/pdfjs` files in deployed frontend assets. Documents are rendered locally, without an external document service.

Field focus uses `fields.field_locations[field_key]` with a one-based `page` and normalized, top-left `x`, `y`, `width`, `height`. SAP source coordinates are preserved when supplied. Existing records without coordinates show a message instead of an invented highlight; re-extraction can populate them.

Checks: `node --test tests/processor-review.test.cjs` and `npx ui5 build --dest dist`.

## Design branch note

`design/ap-console-v2` is a from-scratch **Runway** redesign (tokens, motion, IA) while keeping the UI5 runtime and CaseStore API contracts.

To compare with prior product UX:

```bash
git checkout product/ap-automation-platform   # previous pipeline UX work
git checkout design/ap-console-v2             # this redesign (based on main)
```
