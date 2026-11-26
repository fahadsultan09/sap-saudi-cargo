"""Check live SAP AI Core and Document AI authentication/configuration.

This performs no document upload and never prints tokens or client secrets.
Run from the project root after creating config/.env and the two service-key files:
    python scripts/check_sap_connections.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

# Importing these clients also loads config/.env through triage.config.
from triage.ai_core import AICoreClient  # noqa: E402
from triage.doc_ai import DocAIClient  # noqa: E402


def main() -> int:
    failed = False

    print("[1/3] SAP AI Core authentication and deployment")
    try:
        ai = AICoreClient()
        ai._get_token()
        print("  PASS: OAuth token acquired (token not displayed)")
        deployment_url = ai._get_deployment_url()
        print("  PASS: RUNNING foundation-model deployment found")
        print(
            f"  Deployment host: {deployment_url.split('/')[2] if '://' in deployment_url else '(configured endpoint)'}"
        )
    except Exception as exc:
        failed = True
        print(f"  FAIL: {type(exc).__name__}: {exc}")

    print("[2/3] SAP Document AI authentication")
    try:
        dox = DocAIClient()
        dox._get_token()
        print("  PASS: OAuth token acquired (token not displayed)")
        print(
            f"  API host: {dox.dox_url.split('/')[2] if '://' in dox.dox_url else '(configured endpoint)'}"
        )
    except Exception as exc:
        failed = True
        print(f"  FAIL: {type(exc).__name__}: {exc}")

    print("[3/3] Invoice schema configuration")
    schema_id = os.getenv("SAP_DOX_SCHEMA_ID", "").strip()
    if schema_id:
        print("  PASS: SAP_DOX_SCHEMA_ID is configured")
        print("  Schema ID: " + schema_id)
    else:
        try:
            schema_id = dox.find_schema("invoice")
            if schema_id:
                print("  PASS: Invoice schema discovered through SAP Document AI")
                print("  Schema ID: " + schema_id)
                print(
                    "  Tip: set SAP_DOX_SCHEMA_ID in config/.env to use this exact schema."
                )
            else:
                failed = True
                print(
                    "  FAIL: No invoice schema found. Set SAP_DOX_SCHEMA_ID in config/.env."
                )
        except Exception as exc:
            failed = True
            print(f"  FAIL: Schema discovery failed: {type(exc).__name__}: {exc}")

    print("\nConnection check " + ("FAILED" if failed else "PASSED"))
    if not failed:
        print(
            "Next: start the API with run_api.bat and upload a real invoice PDF in /docs."
        )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
