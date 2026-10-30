import builtins
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.common import RANGES, bucket_expr, bucket_time, range_start, resolve_source
from app.db.session import get_db
from app.models import Alert, Device, Interface, Location, utcnow
from app.schemas import AlertOut, AlertPage, RangeKey

router = APIRouter()
Source = Literal["demo", "local", "snmp", "all"] | None
CATEGORIES = ("congestion", "traffic_anomaly", "device_unavailable", "collector_error")


def _out(db: Session, alerts: list[Alert]) -> list[dict]:
    devs = {d.id: d.name for d in db.scalars(select(Device).where(Device.id.in_({a.device_id for a in alerts})))}
    ifs = {i.id: i.name for i in db.scalars(select(Interface).where(Interface.id.in_({a.interface_id for a in alerts})))}
    locs = {loc.id: loc.name for loc in db.scalars(select(Location))}
    return [AlertOut.model_validate(a).model_copy(update={
        "device_name": devs.get(a.device_id), "interface_name": ifs.get(a.interface_id),
        "location_name": locs.get(a.location_id)}).model_dump() for a in alerts]


@router.get("/alerts", response_model=AlertPage)
def list_alerts(severity: Literal["info", "warning", "critical"] | None = None,
                category: Literal[CATEGORIES] | None = None,
                status: Literal["active", "resolved"] | None = None,
                acknowledged: bool | None = None, range: RangeKey | None = None, source: Source = None,
                device_id: int | None = None, location_id: int | None = None,
                limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0), db: Session = Depends(get_db)):
    q = select(Alert)
    src = resolve_source(db, source)
    if src:
        q = q.where(Alert.source_mode == src)
    if severity:
        q = q.where(Alert.severity == severity)
    if category:
        q = q.where(Alert.category == category)
    if status:
        q = q.where(Alert.status == status)
    if acknowledged is not None:
        q = q.where(Alert.acknowledged_at.is_not(None) if acknowledged else Alert.acknowledged_at.is_(None))
    if range:  # alerts that were open at any point in the range
        start = range_start(range)
        q = q.where((Alert.status == "active") | (Alert.resolved_at >= start) | (Alert.created_at >= start))
    if device_id is not None:
        q = q.where(Alert.device_id == device_id)
    if location_id is not None:
        q = q.where(Alert.location_id == location_id)
    total = db.scalar(select(func.count()).select_from(q.subquery()))
    rows = db.scalars(q.order_by((Alert.status == "active").desc(), Alert.updated_at.desc())
                      .limit(limit).offset(offset)).all()
    return {"total": total, "items": _out(db, list(rows))}


@router.get("/alerts/stats")
def alert_stats(range: RangeKey = "24h", source: Source = None, db: Session = Depends(get_db)):
    """Alert history: counts of alerts raised per time bucket and category."""
    src = resolve_source(db, source)
    start, bucket_s = range_start(range), RANGES[range][1] * (4 if range in ("15m", "1h") else 1)
    b = bucket_expr(Alert.created_at, bucket_s)
    q = select(b, Alert.category, func.count()).where(Alert.created_at >= start).group_by(b, Alert.category)
    if src:
        q = q.where(Alert.source_mode == src)
    timeline: dict[int, dict] = {}
    totals = dict.fromkeys(CATEGORIES, 0)
    for bucket, cat, n in db.execute(q).all():
        timeline.setdefault(bucket, {"t": bucket_time(bucket, bucket_s), **dict.fromkeys(CATEGORIES, 0)})[cat] = n
        totals[cat] += n
    sev_q = select(Alert.severity, func.count()).where(Alert.created_at >= start).group_by(Alert.severity)
    if src:
        sev_q = sev_q.where(Alert.source_mode == src)
    first, last = int(start.timestamp()) // bucket_s, int(utcnow().timestamp()) // bucket_s
    for k in builtins.range(first, last + 1):  # `range` is the query param here; zero-fill so the chart's time axis is continuous
        timeline.setdefault(k, {"t": bucket_time(k, bucket_s), **dict.fromkeys(CATEGORIES, 0)})
    return {"range": range, "bucket_seconds": bucket_s, "source_mode": src or "all", "by_category": totals,
            "by_severity": {"info": 0, "warning": 0, "critical": 0, **dict(db.execute(sev_q).all())},
            "timeline": [timeline[k] for k in sorted(timeline)]}


@router.get("/alerts/{alert_id}", response_model=AlertOut)
def get_alert(alert_id: int, db: Session = Depends(get_db)):
    a = db.get(Alert, alert_id)
    if a is None:
        raise HTTPException(404, f"alert {alert_id} not found")
    return _out(db, [a])[0]


@router.post("/alerts/{alert_id}/acknowledge", response_model=AlertOut)
def acknowledge(alert_id: int, db: Session = Depends(get_db)):
    a = db.get(Alert, alert_id)
    if a is None:
        raise HTTPException(404, f"alert {alert_id} not found")
    if a.acknowledged_at is None:
        a.acknowledged_at = utcnow()
        db.commit()
    return _out(db, [a])[0]
