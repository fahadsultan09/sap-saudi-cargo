#!/usr/bin/env python3
"""SACC-POC-Triage Email Intake Agent CLI entry point.

Fetch and enrich the latest email(s) from Microsoft Graph. No triage and
no classification here — that is handled by the Triage Agent.

Usage:
    python run_email_intake.py                # latest email only
    python run_email_intake.py --top 10       # up to 10 most recent emails
"""

import sys
from pathlib import Path

# Ensure src/ is on the path when running from the project root
sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from email_intake.runner import main
from workflow.run_log import setup_logging

if __name__ == "__main__":
    setup_logging()
    main()