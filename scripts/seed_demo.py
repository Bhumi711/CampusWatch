"""Create the default campus areas and seed synthetic demo history (idempotent: does nothing if demo data exists).

Usage (from the repo root, backend venv):  backend/.venv/bin/python scripts/seed_demo.py [--hours 24] [--seed 42]
The backend also does this automatically on startup when DEMO_AUTO_SEED=true.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.db.session import SessionLocal, init_db  # noqa: E402
from app.services import seed  # noqa: E402
from app.services.settings_store import get_settings  # noqa: E402

parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
parser.add_argument("--hours", type=int, default=None, help="history to backfill (default DEMO_HISTORY_HOURS)")
parser.add_argument("--seed", type=int, default=None, help="random seed (default DEMO_SEED)")
args = parser.parse_args()

init_db()
with SessionLocal() as db:
    get_settings(db)
    seed.ensure_locations(db)
    print(seed.seed_demo(db, hours=args.hours, seed=args.seed))
