"""Delete ALL demo devices, samples and alerts, then reseed. Local/SNMP data is untouched.

Usage (backend stopped, repo root):  backend/.venv/bin/python scripts/reset_demo.py [--yes] [--clear-only]
While the backend is running, prefer Settings -> Demo data -> Reset (keeps the running detectors in sync).
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.db.session import SessionLocal, init_db  # noqa: E402
from app.services import seed  # noqa: E402

parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
parser.add_argument("--yes", action="store_true", help="skip the confirmation prompt")
parser.add_argument("--clear-only", action="store_true", help="delete demo data without reseeding")
args = parser.parse_args()

if not args.yes and input("This permanently deletes all demo data. Type 'reset' to continue: ").strip() != "reset":
    sys.exit("Aborted.")
init_db()
with SessionLocal() as db:
    if args.clear_only:
        seed.clear_demo(db)
        print({"cleared": True})
    else:
        print(seed.reset_demo(db))
