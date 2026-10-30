"""Overview summary and traffic analytics."""
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.common import (RANGES, bucket_time, bucketed, device_out, devices_for, gap_fill, range_start,
                            resolve_source, stale_cutoff)
from app.db.session import get_db
from app.models import Alert, Device, Interface, Location, MetricSample, utcnow
from app.schemas import GroupedSeries, RangeKey, Summary, TopItem, TrafficSeries

router = APIRouter()
Source = Literal["demo", "local", "snmp", "all"] | None


@router.get("/summary", response_model=Summary)
def summary(source: Source = None, db: Session = Depends(get_db)):
    src = resolve_source(db, source)
    cutoff = stale_cutoff(db)
    devices = [device_out(d, cutoff) for d in devices_for(db, src)]
    ifaces = [i for d in devices for i in d["_interfaces"]]
    fresh = [i for i in ifaces if not i["stale"] and (i["in_bps"] is not None or i["out_bps"] is not None)]
    ins = [i["in_bps"] for i in fresh if i["in_bps"] is not None]
    outs = [i["out_bps"] for i in fresh if i["out_bps"] is not None]
    utils = [(i["utilization_pct"], i) for i in fresh if i["utilization_pct"] is not None]
    top = max(utils, key=lambda x: x[0], default=None)
    dev_names = {d["id"]: d["name"] for d in devices}
    as_of = max((i["updated_at"] for i in fresh), default=None)

    aq = select(Alert.severity, Alert.acknowledged_at.is_(None), func.count()).where(Alert.status == "active") \
        .group_by(Alert.severity, Alert.acknowledged_at.is_(None))
    if src:
        aq = aq.where(Alert.source_mode == src)
    alerts = {"active": 0, "info": 0, "warning": 0, "critical": 0, "unacknowledged": 0}
    for sev, unacked, n in db.execute(aq).all():
        alerts["active"] += n
        alerts[sev] += n
        alerts["unacknowledged"] += n if unacked else 0

    return {
        "source_mode": src or "all", "synthetic": src == "demo", "generated_at": utcnow(),
        "devices": {"total": len(devices), **{s: sum(d["status"] == s for d in devices)
                                               for s in ("online", "offline", "unknown")}},
        "traffic": {"in_bps": sum(ins) if ins else None, "out_bps": sum(outs) if outs else None,
                    "interfaces_reporting": len(fresh), "interfaces_total": len(ifaces), "as_of": as_of},
        "utilization": {
            "links_with_capacity": sum(1 for i in ifaces if i["capacity_bps"]),
            "average_pct": sum(u for u, _ in utils) / len(utils) if utils else None,
            "max_pct": top[0] if top else None,
            "max_interface": {"interface_id": top[1]["id"], "name": top[1]["name"], "device_id": top[1]["device_id"],
                              "device_name": dev_names.get(top[1]["device_id"])} if top else None},
        "alerts": alerts,
    }


@router.get("/metrics/traffic", response_model=TrafficSeries)
def traffic(range: RangeKey = "1h", source: Source = None, location_id: int | None = None,
            device_id: int | None = None, interface_id: int | None = None, db: Session = Depends(get_db)):
    src = resolve_source(db, source)
    bucket_s = RANGES[range][1]
    rows = bucketed(db, range_start(range), bucket_s, src, location_id=location_id, device_id=device_id,
                    interface_id=interface_id)
    points = [{"t": bucket_time(b, bucket_s), "in_bps": i, "out_bps": o} for b, i, o in rows]
    return {"range": range, "bucket_seconds": bucket_s, "source_mode": src or "all",
            "points": gap_fill(points, bucket_s)}


@router.get("/metrics/traffic/by-location", response_model=GroupedSeries)
def traffic_by_location(range: RangeKey = "1h", source: Source = None, db: Session = Depends(get_db)):
    src = resolve_source(db, source)
    bucket_s = RANGES[range][1]
    names = {loc.id: loc.name for loc in db.scalars(select(Location))}
    by_t: dict = {}
    stats: dict[str, dict] = {}
    for b, g, i, o in bucketed(db, range_start(range), bucket_s, src, by_location=True):
        key = f"loc{g or 0}"
        total = None if i is None and o is None else (i or 0) + (o or 0)
        by_t.setdefault(b, {"t": bucket_time(b, bucket_s)})[key] = total
        st = stats.setdefault(key, {"name": names.get(g, "Unassigned"), "tot": [], "in": [], "out": []})
        if total is not None:
            st["tot"].append(total)
            st["in"].append(i or 0)
            st["out"].append(o or 0)
    avg = lambda xs: sum(xs) / len(xs) if xs else None  # noqa: E731
    groups = [{"key": k, "name": s["name"], "avg_total_bps": avg(s["tot"]), "peak_total_bps": max(s["tot"], default=None),
               "avg_in_bps": avg(s["in"]), "avg_out_bps": avg(s["out"])} for k, s in sorted(stats.items())]
    points = [{k: by_t[b].get(k) if k != "t" else by_t[b]["t"] for k in ["t", *stats]} for b in sorted(by_t)]
    return {"range": range, "bucket_seconds": bucket_s, "source_mode": src or "all", "groups": groups,
            "points": gap_fill(points, bucket_s)}


@router.get("/metrics/top", response_model=list[TopItem])
def top_talkers(range: RangeKey = "1h", source: Source = None, by: Literal["interface", "device"] = "interface",
                limit: int = Query(10, ge=1, le=50), db: Session = Depends(get_db)):
    src = resolve_source(db, source)
    start = range_start(range)
    total = MetricSample.inbound_bps + MetricSample.outbound_bps
    per_iface = (select(MetricSample.device_id.label("d"), MetricSample.interface_id.label("i"),
                        func.avg(MetricSample.inbound_bps).label("ain"), func.avg(MetricSample.outbound_bps).label("aout"),
                        func.max(total).label("peak"), func.max(MetricSample.utilization_pct).label("umax"),
                        func.min(MetricSample.timestamp).label("t0"), func.max(MetricSample.timestamp).label("t1"))
                 .where(MetricSample.interface_id.is_not(None), MetricSample.timestamp >= start,
                        MetricSample.inbound_bps.is_not(None))
                 .group_by(MetricSample.device_id, MetricSample.interface_id))
    if src:
        per_iface = per_iface.where(MetricSample.source_mode == src)
    sub = per_iface.subquery()
    if by == "interface":
        q = select(sub.c.i, sub.c.ain, sub.c.aout, sub.c.peak, sub.c.umax, sub.c.t0, sub.c.t1)
    else:  # device = sum of its interfaces' averages; peak/max of its busiest interface
        q = select(sub.c.d, func.sum(sub.c.ain), func.sum(sub.c.aout), func.max(sub.c.peak), func.max(sub.c.umax),
                   func.min(sub.c.t0), func.max(sub.c.t1)).group_by(sub.c.d)
    q = q.order_by((q.selected_columns[1] + q.selected_columns[2]).desc()).limit(limit)
    out = []
    for obj_id, ain, aout, peak, umax, t0, t1 in db.execute(q).all():
        if by == "interface":
            i = db.get(Interface, obj_id)
            dev, name, iid = i.device, f"{i.device.name} {i.name}", i.id
        else:
            dev = db.get(Device, obj_id)
            name, iid = dev.name, None
        span = (t1 - t0).total_seconds() if t0 and t1 else 0
        out.append({"interface_id": iid, "device_id": dev.id, "name": name, "device_name": dev.name,
                    "location_name": dev.location.name if dev.location else None, "avg_in_bps": ain,
                    "avg_out_bps": aout, "peak_total_bps": peak, "max_utilization_pct": umax,
                    "est_bytes": ((ain or 0) + (aout or 0)) * span / 8 if span else None})
    return out
