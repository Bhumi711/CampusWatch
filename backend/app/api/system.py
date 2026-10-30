"""Health, settings, collector control, detector status and demo data management."""
import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ValidationError
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.config import env
from app.db.session import SessionLocal, get_db
from app.models import CollectorRun
from app.schemas import SettingsOut, SettingsPatch
from app.services import seed
from app.services.poller import ml, poller
from app.services.settings_store import get_settings, update_settings

health_router = APIRouter()
router = APIRouter()


class Confirm(BaseModel):
    confirm: bool


def _run_out(r: CollectorRun | None) -> dict | None:
    if r is None:
        return None
    return {"id": r.id, "mode": r.mode, "trigger": r.trigger, "started_at": r.started_at, "finished_at": r.finished_at,
            "success": r.success, "error": r.error, "devices_polled": r.devices_polled,
            "devices_failed": r.devices_failed, "samples_written": r.samples_written, "details": r.details or []}


@health_router.get("/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok", "database": "ok", "collector_running": poller.running,
            "mode": get_settings(db).collection_mode}


def _settings_out(db: Session) -> dict:
    return {**get_settings(db).model_dump(), "demo_seed": env.demo_seed,
            "demo_history_hours": env.demo_history_hours, "snmp_timeout_seconds": env.snmp_timeout_seconds,
            "snmp_retries": env.snmp_retries}


@router.get("/settings", response_model=SettingsOut)
def read_settings(db: Session = Depends(get_db)):
    return _settings_out(db)


@router.patch("/settings", response_model=SettingsOut)
def patch_settings(body: SettingsPatch, db: Session = Depends(get_db)):
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    before = get_settings(db)
    try:
        after = update_settings(db, changes)
    except ValidationError as exc:
        raise HTTPException(422, [{"loc": e["loc"], "msg": e["msg"]} for e in exc.errors(include_url=False)])
    if (after.collection_mode, after.poll_interval_seconds) != (before.collection_mode, before.poll_interval_seconds):
        poller.wake.set()  # apply immediately instead of after the current sleep
    return _settings_out(db)


@router.get("/collector/status")
def collector_status(db: Session = Depends(get_db)):
    rs = get_settings(db)
    last = db.scalars(select(CollectorRun).where(CollectorRun.trigger != "seed")
                      .order_by(CollectorRun.started_at.desc()).limit(1)).first()
    last_ok = db.scalars(select(CollectorRun).where(CollectorRun.mode == rs.collection_mode,
                                                    CollectorRun.success.is_(True), CollectorRun.trigger != "seed")
                         .order_by(CollectorRun.started_at.desc()).limit(1)).first()
    return {"mode": rs.collection_mode, "synthetic": rs.collection_mode == "demo",
            "poll_interval_seconds": rs.poll_interval_seconds, "running": poller.running,
            "polling_now": poller.lock.locked(), "next_poll_at": poller.next_poll_at,
            "last_run": _run_out(last), "last_success_at": last_ok.finished_at if last_ok else None}


@router.get("/collector/runs")
def collector_runs(limit: int = Query(20, ge=1, le=200), db: Session = Depends(get_db)):
    runs = db.scalars(select(CollectorRun).order_by(CollectorRun.started_at.desc()).limit(limit)).all()
    return [_run_out(r) for r in runs]


@router.post("/collector/poll")
async def trigger_poll():
    run_id = await poller.poll_once(trigger="manual")
    with SessionLocal() as db:
        return _run_out(db.get(CollectorRun, run_id))


@router.get("/detection/status")
def detection_status(db: Session = Depends(get_db)):
    rs = get_settings(db)
    return {
        "rule_based": {"enabled": True, "method": "Rolling per-interface baseline (z-score + ratio gate)",
                       "window_samples": rs.anomaly_window_samples, "zscore_threshold": rs.anomaly_zscore_threshold,
                       "min_ratio": rs.anomaly_min_ratio, "min_bps": rs.anomaly_min_bps},
        "congestion": {"warning_pct": rs.congestion_warning_pct, "critical_pct": rs.congestion_critical_pct,
                       "consecutive_samples": rs.congestion_consecutive_samples},
        "isolation_forest": ml.status(rs.ml_enabled, rs.ml_contamination)
        | {"active_for_mode": ml.model is not None and ml.source_mode == rs.collection_mode},
        "source_mode": rs.collection_mode,
    }


@router.post("/detection/ml/train")
async def train_model():
    def _train():
        with SessionLocal() as db:
            rs = get_settings(db)
            if not rs.ml_enabled:
                raise HTTPException(409, "Isolation Forest is disabled in settings")
            ml.train(db, rs.collection_mode)
            return detection_status(db)
    return await asyncio.to_thread(_train)


def _require(body: Confirm):
    if not body.confirm:
        raise HTTPException(400, "set confirm=true to perform this destructive action")


@router.post("/demo/reset")
async def reset_demo(body: Confirm):
    _require(body)
    async with poller.lock:  # no poll may interleave with the rebuild
        def _do():
            with SessionLocal() as db:
                return seed.reset_demo(db)
        return await asyncio.to_thread(_do)


@router.post("/demo/clear")
async def clear_demo(body: Confirm):
    _require(body)
    async with poller.lock:
        def _do():
            with SessionLocal() as db:
                seed.clear_demo(db)
                return {"cleared": True}
        return await asyncio.to_thread(_do)
