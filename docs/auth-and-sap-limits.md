# Auth & SAP posting limits (local demo)

## Auth

ClearDesk’s thin gateway exposes **`GET /auth/me`** as a demo session profile built from:

- `X-User-Id` / `X-User-Role` / `X-User-Email` request headers (role switcher), or
- env defaults: `GATEWAY_DEMO_USER_ID`, `GATEWAY_DEMO_USER_ROLE`, `GATEWAY_DEMO_USER_NAME`, `GATEWAY_DEMO_USER_EMAIL`

This is **API-backed** so “Signed in as” is not FE-only fiction. It is **not** Keycloak.

Full Keycloak / OIDC (as on `backend-abdulahad`’s `gateway/app/auth`) still needs:

- a reachable Keycloak (or IAS) issuer URL
- client id + client secret / public client config
- callback URL aligned with `public_url`
- session cookie settings for the FE origin

Until those credentials and a running IdP are available, keep using the demo `/auth/me` stub.

## SAP posting

Approve records a decision and a `posting_records` row with status **`READY_FOR_POSTING`**. Live FI posting to SAP is **not configured** in this POC. The UI says “Approved — ready for posting” honestly.

## SAP field comparison

Invoice vs SAP rows come from local Excel exports under `agentic-ai/data/sap_excel` (ported from `backend-abdulahad`) via `SourceCheckAgent`. When exports or a matching PO are missing, Summary falls back to synthesized field rows.
