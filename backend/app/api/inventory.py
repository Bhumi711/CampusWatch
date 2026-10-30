"""Locations, devices (incl. SNMP targets) and interfaces."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.common import (RANGES, bucket_expr, bucket_time, bucketed, device_out, devices_for, gap_fill,
                            range_start, resolve_source, stale_cutoff)
from app.db.session import get_db
from app.models import Alert, Device, Interface, Location, MetricSample
from app.schemas import (DeviceCreate, DeviceDetail, DeviceMetrics, DeviceOut, DevicePatch, InterfacePatch,
                         InterfaceRow, LocationIn, LocationOut, LocationPatch, LocationSummary, RangeKey,
                         SnmpTestResult)
from app.services.poller import to_target

router = APIRouter()
Source = Literal["demo", "local", "snmp", "all"] | None
SECRET_FIELDS = ("snmp_community", "snmp_auth_key", "snmp_priv_key")


def _get(db: Session, model, obj_id: int):
    obj = db.get(model, obj_id)
    if obj is None:
        raise HTTPException(404, f"{model.__name__} {obj_id} not found")
    return obj


def _check_location(db: Session, location_id: int | None):
    if location_id is not None and db.get(Location, location_id) is None:
        raise HTTPException(422, f"location {location_id} does not exist")


# ---------- locations ----------
@router.get("/locations", response_model=list[LocationSummary])
def list_locations(range: RangeKey = "1h", source: Source = None, db: Session = Depends(get_db)):
    src = resolve_source(db, source)
    cutoff = stale_cutoff(db)
    devices = [device_out(d, cutoff) for d in devices_for(db, src)]
    rows = bucketed(db, range_start(range), RANGES[range][1], src, by_location=True)
    totals: dict[int | None, list[float]] = {}
    for _, g, i, o in rows:
        if i is not None or o is not None:
            totals.setdefault(g, []).append((i or 0) + (o or 0))
    alert_q = select(Alert.location_id, func.count()).where(Alert.status == "active").group_by(Alert.location_id)
    if src:
        alert_q = alert_q.where(Alert.source_mode == src)
    alerts = dict(db.execute(alert_q).all())

    locs = [LocationOut.model_validate(loc).model_dump() for loc in db.scalars(select(Location).order_by(Location.id))]
    if any(d["location_id"] is None for d in devices):
        locs.append({"id": 0, "name": "Unassigned", "subnet": None, "vlan": None,
                     "description": "Devices not assigned to a campus area"})
    out = []
    for loc in locs:
        key = loc["id"] or None
        devs = [d for d in devices if d["location_id"] == key]
        ins = [d["in_bps"] for d in devs if d["in_bps"] is not None]
        outs = [d["out_bps"] for d in devs if d["out_bps"] is not None]
        utils = [d["max_utilization_pct"] for d in devs if d["max_utilization_pct"] is not None]
        series = totals.get(key, [])
        out.append({**loc, "devices_total": len(devs),
                    **{f"devices_{s}": sum(d["status"] == s for d in devs) for s in ("online", "offline", "unknown")},
                    "in_bps": sum(ins) if ins else None, "out_bps": sum(outs) if outs else None,
                    "avg_total_bps": sum(series) / len(series) if series else None,
                    "peak_total_bps": max(series) if series else None,
                    "max_utilization_pct": max(utils) if utils else None, "active_alerts": alerts.get(key, 0)})
    return out


@router.post("/locations", response_model=LocationOut, status_code=201)
def create_location(body: LocationIn, db: Session = Depends(get_db)):
    loc = Location(**body.model_dump())
    db.add(loc)
    try:
        db.commit()
    except IntegrityError:
        raise HTTPException(409, f"a location named '{body.name}' already exists")
    return loc


@router.patch("/locations/{location_id}", response_model=LocationOut)
def update_location(location_id: int, body: LocationPatch, db: Session = Depends(get_db)):
    loc = _get(db, Location, location_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        if k == "name" and v is None:
            continue
        setattr(loc, k, v)
    try:
        db.commit()
    except IntegrityError:
        raise HTTPException(409, "location name already in use")
    return loc


@router.delete("/locations/{location_id}", status_code=204)
def delete_location(location_id: int, db: Session = Depends(get_db)):
    db.delete(_get(db, Location, location_id))  # devices/samples/alerts keep existing with location = NULL
    db.commit()


# ---------- devices ----------
@router.get("/devices", response_model=list[DeviceOut])
def list_devices(source: Source = None, location_id: int | None = None, device_type: str | None = None,
                 status: Literal["online", "offline", "unknown"] | None = None,
                 q: str | None = Query(None, max_length=100), db: Session = Depends(get_db)):
    cutoff = stale_cutoff(db)
    out = [device_out(d, cutoff) for d in devices_for(db, resolve_source(db, source))]
    if location_id is not None:
        out = [d for d in out if (d["location_id"] or 0) == location_id]
    if device_type:
        out = [d for d in out if d["device_type"] == device_type]
    if status:
        out = [d for d in out if d["status"] == status]
    if q:
        needle = q.lower()
        out = [d for d in out if needle in f"{d['name']} {d['address']} {d['location_name'] or ''}".lower()]
    return out


@router.get("/devices/{device_id}", response_model=DeviceDetail)
def get_device(device_id: int, db: Session = Depends(get_db)):
    d = _get(db, Device, device_id)
    data = device_out(d, stale_cutoff(db))
    active = db.scalar(select(func.count()).where(Alert.device_id == d.id, Alert.status == "active"))
    return {**data, "interfaces": data["_interfaces"], "active_alerts": active}


@router.post("/devices", response_model=DeviceDetail, status_code=201)
def create_snmp_device(body: DeviceCreate, db: Session = Depends(get_db)):
    _check_location(db, body.location_id)
    loc = db.get(Location, body.location_id) if body.location_id else None
    d = Device(**body.model_dump(), source_mode="snmp")
    d.subnet = d.subnet or (loc.subnet if loc else None)
    d.vlan = d.vlan or (loc.vlan if loc else None)
    db.add(d)
    db.commit()
    return get_device(d.id, db)


@router.patch("/devices/{device_id}", response_model=DeviceDetail)
def update_device(device_id: int, body: DevicePatch, db: Session = Depends(get_db)):
    d = _get(db, Device, device_id)
    changes = body.model_dump(exclude_unset=True)
    if "location_id" in changes:
        _check_location(db, changes["location_id"])
    snmp_keys = {k for k in changes if k.startswith("snmp_") or k == "address"}
    if snmp_keys and d.source_mode != "snmp":
        raise HTTPException(422, f"{', '.join(sorted(snmp_keys))} can only be changed on SNMP devices")
    for k, v in changes.items():
        if k in SECRET_FIELDS and not v:
            continue  # blank secret = keep the stored one
        if k == "name" and v is None:
            continue
        setattr(d, k, v)
    db.commit()
    return get_device(d.id, db)


@router.delete("/devices/{device_id}", status_code=204)
def delete_device(device_id: int, db: Session = Depends(get_db)):
    db.delete(_get(db, Device, device_id))
    db.commit()


@router.post("/devices/{device_id}/test", response_model=SnmpTestResult)
async def test_snmp_device(device_id: int, db: Session = Depends(get_db)):
    d = _get(db, Device, device_id)
    if d.source_mode != "snmp":
        raise HTTPException(422, "connection tests are only available for SNMP devices")
    from app.collectors.snmp import test_target
    try:
        return await test_target(to_target(d))
    except ValueError as exc:  # missing credentials etc.
        return {"reachable": False, "error": str(exc)}


@router.get("/devices/{device_id}/metrics", response_model=DeviceMetrics)
def device_metrics(device_id: int, range: RangeKey = "1h", interface_id: int | None = None,
                   db: Session = Depends(get_db)):
    d = _get(db, Device, device_id)
    start, bucket_s = range_start(range), RANGES[range][1]
    ifaces = [i for i in d.interfaces if interface_id is None or i.id == interface_id]
    series = []
    for i in ifaces:
        pts = [{"t": bucket_time(b, bucket_s), "in_bps": inn, "out_bps": out}
               for b, inn, out in bucketed(db, start, bucket_s, None, interface_id=i.id)]
        for p in pts:
            p["utilization_pct"] = (max(v for v in (p["in_bps"], p["out_bps"]) if v is not None) / i.capacity_bps * 100
                                    if i.capacity_bps and (p["in_bps"] is not None or p["out_bps"] is not None)
                                    else None)
        series.append({"interface_id": i.id, "name": i.name, "alias": i.alias, "points": gap_fill(pts, bucket_s)})
    b = bucket_expr(MetricSample.timestamp, bucket_s)
    sys_rows = db.execute(
        select(b, func.avg(MetricSample.cpu_pct), func.avg(MetricSample.memory_pct))
        .where(MetricSample.device_id == d.id, MetricSample.interface_id.is_(None), MetricSample.timestamp >= start)
        .group_by(b).order_by(b)).all()
    system = gap_fill([{"t": bucket_time(r[0], bucket_s), "cpu_pct": r[1], "memory_pct": r[2]} for r in sys_rows],
                      bucket_s)
    return {"range": range, "bucket_seconds": bucket_s, "interfaces": series, "system": system}


# ---------- interfaces ----------
@router.get("/interfaces", response_model=list[InterfaceRow])
def list_interfaces(source: Source = None, location_id: int | None = None, device_id: int | None = None,
                    db: Session = Depends(get_db)):
    cutoff = stale_cutoff(db)
    rows = []
    for d in devices_for(db, resolve_source(db, source)):
        if (location_id is not None and (d.location_id or 0) != location_id) or \
                (device_id is not None and d.id != device_id):
            continue
        dev = device_out(d, cutoff)
        for i in dev["_interfaces"]:
            rows.append({**i, "device_name": d.name, "device_status": dev["status"], "location_id": d.location_id,
                         "location_name": dev["location_name"], "source_mode": d.source_mode})
    return rows


@router.patch("/interfaces/{interface_id}", response_model=InterfaceRow)
def update_interface(interface_id: int, body: InterfacePatch, db: Session = Depends(get_db)):
    i = _get(db, Interface, interface_id)
    changes = body.model_dump(exclude_unset=True)
    if "alias" in changes:
        i.alias = changes["alias"]
    if "capacity_bps" in changes:
        i.capacity_bps = changes["capacity_bps"]
        i.capacity_source = "configured" if changes["capacity_bps"] else None
        i.utilization_pct = None  # recomputed on the next poll with the new capacity
    db.commit()
    return next(r for r in list_interfaces("all", None, i.device_id, db) if r["id"] == i.id)
