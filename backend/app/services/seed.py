"""Idempotent demo seeding: default campus areas, synthetic devices and a backfilled history run through the
same processor/detectors as live polling (so seeded alerts are genuine detector output on synthetic data)."""
from datetime import timedelta

from sqlalchemy import delete, exists, select
from sqlalchemy.orm import Session

from app.collectors.demo import DEVICES, LOCATIONS, DemoCollector
from app.core.config import env
from app.models import Alert, CollectorRun, Device, Interface, Location, MetricSample, utcnow
from app.services import poller
from app.services.alerts import AlertBook
from app.services.settings_store import get_settings


def ensure_locations(db: Session) -> None:
    if db.scalar(select(Location.id).limit(1)) is None:
        db.add_all(Location(**loc) for loc in LOCATIONS)
        db.commit()


def has_demo_data(db: Session) -> bool:
    return bool(db.scalar(select(exists().where(Device.source_mode == "demo"))))


def seed_demo(db: Session, hours: int | None = None, seed: int | None = None, step_s: int = 60) -> dict:
    if has_demo_data(db):
        return {"seeded": False, "reason": "demo data already present"}
    hours, seed = hours or env.demo_history_hours, seed if seed is not None else env.demo_seed
    started = utcnow()
    ensure_locations(db)
    locs = {loc.name: loc for loc in db.scalars(select(Location))}
    for spec in DEVICES:
        loc = locs.get(spec["loc"])
        dev = Device(name=spec["name"], address=spec["ip"], device_type=spec["type"], source_mode="demo",
                     location_id=loc.id if loc else None, subnet=loc.subnet if loc else None,
                     vlan=loc.vlan if loc else None, enabled=spec.get("enabled", True), meta=spec.get("meta"))
        dev.interfaces = [Interface(name=i["name"], alias=i["alias"], capacity_bps=i["capacity"],
                                    capacity_source="reported" if i["capacity"] else None,
                                    meta={"profile": i["profile"], "capacity": i["capacity"]})
                          for i in spec["ifaces"]]
        db.add(dev)
    db.commit()

    rs = get_settings(db)
    poller.reset_detectors()
    collector = DemoCollector(seed)
    devices = db.scalars(select(Device).where(Device.source_mode == "demo", Device.enabled.is_(True))).unique().all()
    t, end, total, steps = started - timedelta(hours=hours), started, 0, 0
    book = AlertBook(db, t, rs.alert_cooldown_seconds)
    while t <= end:
        result = collector.collect_sync([poller.to_target(d) for d in devices], t)
        total += poller.process(db, "demo", result, t, rs, book)[0]
        steps += 1
        if steps % 120 == 0:
            db.commit()
        t += timedelta(seconds=step_s)
    db.add(CollectorRun(mode="demo", trigger="seed", started_at=started, finished_at=utcnow(), success=True,
                        devices_polled=len(devices), samples_written=total,
                        error=None, details=[{"note": f"Backfilled {hours}h of synthetic history (seed {seed})"}]))
    db.commit()
    if rs.ml_enabled:
        poller.ml.train(db, "demo")
    return {"seeded": True, "hours": hours, "seed": seed, "samples": total, "devices": len(DEVICES)}


def clear_demo(db: Session) -> None:
    db.execute(delete(Alert).where(Alert.source_mode == "demo"))
    db.execute(delete(MetricSample).where(MetricSample.source_mode == "demo"))
    db.execute(delete(Device).where(Device.source_mode == "demo"))  # interfaces cascade
    db.execute(delete(CollectorRun).where(CollectorRun.mode == "demo"))
    db.commit()
    poller.reset_detectors()


def reset_demo(db: Session) -> dict:
    clear_demo(db)
    return seed_demo(db)
