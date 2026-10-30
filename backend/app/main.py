import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import alerts, inventory, metrics, system
from app.core.config import env
from app.db.session import SessionLocal, init_db
from app.services import seed
from app.services.poller import poller
from app.services.settings_store import get_settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("campus")


def _startup() -> None:
    init_db()
    with SessionLocal() as db:
        get_settings(db)  # create the settings row from env defaults
        seed.ensure_locations(db)
        if env.demo_auto_seed and not seed.has_demo_data(db):
            log.info("Seeding %sh of synthetic demo history (one-time)...", env.demo_history_hours)
            log.info("Demo seed: %s", seed.seed_demo(db))


@asynccontextmanager
async def lifespan(_: FastAPI):
    await asyncio.to_thread(_startup)
    if env.collector_enabled:
        poller.start()
    yield
    await poller.stop()


app = FastAPI(title="Smart Campus Network Monitor API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in env.cors_origins.split(",") if o.strip()],
                   allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["Content-Type"])
app.include_router(system.health_router)
for r in (system.router, metrics.router, inventory.router, alerts.router):
    app.include_router(r, prefix="/api/v1")
