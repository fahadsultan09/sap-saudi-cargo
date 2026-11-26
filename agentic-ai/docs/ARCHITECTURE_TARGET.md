# AP Automation — Target Architecture and Implementation Order

## Non-negotiable ownership rules

1. **AP Core is the business authority.** It owns case state, deterministic decisions, work scheduling, and the next allowed transition.
2. **Agents recommend; they do not authorize.** Classification/extraction outputs are stored as evidence/model judgements. No agent may approve or post an invoice.
3. **Workers perform bounded external effects.** Each worker should have a narrow contract, stable idempotency key, timeout, and recorded result.
4. **Deterministic rules decide financial eligibility.** Use explicit PASS / FAIL / UNKNOWN / NOT_APPLICABLE outcomes. Unknown is not success; money uses Decimal.
5. **Human decisions are committed by AP Core first.** BPA should orchestrate timers and human tasks, not own the authoritative business state.
6. **Only the posting command writes to S/4HANA.** Approval must freeze and hash a posting package. Posting must be idempotent and unknown outcomes must be resolved by reading SAP before retrying.
7. **S/4HANA remains the financial system of record.** Store time-stamped, hashed snapshots of observed SAP facts; re-read SAP before material decisions/posting.
8. **Every meaningful result is classified** as FACT, EXTERNAL_OBSERVATION, RULE_RESULT, MODEL_JUDGEMENT, HUMAN_DECISION, or SYSTEM_ACTION.

## Target flow

1. **Receive** — API or Microsoft Graph notification creates a receipt and durable work item transactionally.
2. **Acquire** — intake worker leases work, reads the source, and uses a stable source/message + attachment hash claim.
3. **Secure** — validate MIME/signature/size, malware scan, compute SHA-256, retain original in quarantine, and create a secured processing copy.
4. **Classify** — CLASSIFIER may recommend document type and routing; AP Core applies deterministic routing policy.
5. **Extract** — SAP Document AI is the primary extractor; SCANNER may coordinate/recommend. Preserve raw extraction, field confidence, source, and version.
6. **Observe SAP** — read-only adapter fetches supplier, PO, GR/SES, company-code and relevant accounting facts. Persist source, fetch time and hash.
7. **Decide** — AP Core runs duplicate, compliance, matching, tolerance, tax, currency and account rules. Each result is explicit and auditable.
8. **Review** — AP Core creates a durable human work item. BPA receives IDs and coordinates the task. Human response is committed to AP Core.
9. **Approve** — independent approver releases the immutable hash of the posting package; credit notes can require staged approval.
10. **Post** — one dedicated posting-command service validates a server-issued permit, re-reads SAP, writes a command ledger, and posts/parks exactly once logically.
11. **Reconcile** — read back SAP result and reconcile payments/advice; resolve unknown posting outcomes without blind retries.
12. **Notify/report** — notifications, worklists, SSE and audit/reporting read from AP Core read models.

## Implemented in this tranche

- `document_claims` is a durable SHA-256 claim table.
- Existing cases are backfilled to the canonical earliest case per hash at database initialization.
- Exact same-file upload returns the existing visible case and creates no new case, file copy, or processing job.
- Duplicate upload attempts are recorded in `audit_events`.
- SQLite `BEGIN IMMEDIATE` plus the unique `document_claims.sha256` key serializes competing upload writers.
- After extraction, a business-duplicate candidate is detected using supplier identity + invoice number + company code. It is routed to manual review, not automatically rejected.
- A missing `config/document_types.json` in the supplied archive was restored with the document categories already expected by the pipeline.
- Regression tests cover exact-file duplicate uploads and business duplicate identity matching.

## Still required before production

This tranche does **not** mean the target architecture is complete. The following are the next required stages, in order:

1. Replace FastAPI `BackgroundTasks` as the source of truth with a durable `work_items` / outbox table, leases, retries, attempt history, dead-letter handling, and a worker poller. A process restart must not lose work.
2. Separate uploaded source documents from case records and move document bytes to managed quarantine/DMS/object storage. Add malware scanning and retention controls.
3. Persist typed `EXTERNAL_OBSERVATION`, `RULE_RESULT`, `MODEL_JUDGEMENT`, `HUMAN_DECISION`, and `SYSTEM_ACTION` records rather than relying only on JSON blobs and generic audit events.
4. Introduce versioned deterministic finance rules and SAP read-only adapter contracts. Unknown/missing SAP facts must block auto-approval.
5. Add a real approval request lifecycle with separation of duties and BPA continuation only after AP Core commits the decision.
6. Replace the posting placeholder with a separate posting-command boundary, immutable posting package hash, unique command ledger, SAP read-back and unknown-outcome resolver. Until then, the application must not claim that invoices are posted.
7. Move production persistence from SQLite to the chosen managed database (for example HANA Cloud, if required by deployment), with migrations and operational backup/recovery.
8. Add Microsoft Graph notification + delta sweep, source cursors, subscription renewal, secure credentials, malware scanning, structured monitoring, and deployment hardening.

## Duplicate handling policy

- **Exact file duplicate:** return the canonical case if the caller is allowed to see it; otherwise return a generic conflict response. Record the attempt; do not create another case or rerun extraction.
- **Business duplicate candidate:** compare supplier identity, supplier invoice number, and company code after extraction. Route to manual review with the matched case reference. Do not automatically reject solely from this heuristic.
- **Posting duplicate:** independent control. Use a unique posting command/idempotency key and SAP read-back. SHA-256 deduplication alone cannot prevent duplicate financial postings.


## Agent implementations in the current codebase

- **Email Intake** (`src/email_intake`): Microsoft Graph fetch/enrichment component. Live operation requires Graph credentials; it does not classify messages.
- **CLASSIFIER** (`src/agents/classifier.py`): classification adapter backed by SAP AI Core in SAP mode; mock mode is explicitly heuristic-only.
- **SCANNER** (`src/agents/scanner.py`): extraction coordinator backed by SAP Document AI in SAP mode.
- **VERIFIER** (`src/agents/verifier.py`): read-only PO matching recommendation. It accepts an SAP observation or an injected read-only SAP port. If trusted evidence is missing, result is UNKNOWN. No SAP write capability is provided.
- **RECONCILER** (`src/agents/reconciler.py`): evidence-grounded discrepancy investigation and follow-up recommendations based only on supplied rule results, extraction gaps and SAP observations.
- **PLUMB** (`src/agents/plumb.py`): payment advice reconciliation candidate matching using invoice reference, currency and Decimal amounts. It does not mark cases paid.
- **FINANCE_RULES** (`src/agents/rules.py`): deterministic component, not an AI agent.

VERIFIER, RECONCILER and PLUMB are now implemented as callable agent modules and exposed by the agent registry. VERIFIER/RECONCILER/PLUMB are conditionally invoked by `APAgentOrchestrator.run(..., extended_context=...)` when the corresponding input data is supplied. Their adapters are not yet connected to live SAP purchasing data, BPA, or payment advice mailboxes; production integration and AP Core persistence remain separate work. The existing upload endpoint still runs the original CLASSIFIER → SCANNER → FINANCE_RULES path unless an extended context is explicitly supplied.
