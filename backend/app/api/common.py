"""Shared query helpers for routes."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import Integer, cast, func, select
from sqlalchemy.orm import Session, selectinload

from app.models import Device, Interface, MetricSample, utcnow
from app.schemas import DeviceOut, InterfaceOut, SnmpInfo
from app.services.settings_store import get_settings

RANGES = {"15m": (900, 15), "1h": (3600, 60), "6h": (21_600, 300), "24h": (86_400, 900), "7d": (604_800, 3600)}


def resolve_source(db: Session, source: str | None) -> str | None:
    """Default = the active collection mode (so demo and live data never mix). 'all' = no filter."""
    if source is None:
        return get_settings(db).collection_mode
    return None if source == "all" else source


def range_start(key: str) -> datetime:
    return utcnow() - timedelta(seconds=RANGES[key][0])


def stale_cutoff(db: Session) -> datetime:
    """Readings older than ~3 poll intervals are treated as unavailable."""
    return utcnow() - timedelta(seconds=max(3 * get_settings(db).poll_interval_seconds, 60))


def bucket_time(b: int, bucket_s: int) -> datetime:
    return datetime.fromtimestamp(b * bucket_s, tz=timezone.utc)


def bucket_expr(col, bucket_s: int):
    """Epoch-second bucket index (SQLite strftime; swap this for another backend)."""
    return cast(cast(func.strftime("%s", col), Integer) / bucket_s, Integer).label("b")


def bucketed(db: Session, start: datetime, bucket_s: int, source: str | None, *, location_id=None, device_id=None,
             interface_id=None, by_location=False) -> list:
    """Rows (bucket, [location_id,] sum_in, sum_out): per-interface average within each bucket, summed across
    interfaces, so uneven sample counts per bucket don't inflate totals."""
    b = bucket_expr(MetricSample.timestamp, bucket_s)
    cols = [MetricSample.interface_id, b, func.avg(MetricSample.inbound_bps).label("i"),
            func.avg(MetricSample.outbound_bps).label("o")]
    if by_location:
        cols.append(MetricSample.location_id.label("g"))
    q = select(*cols).where(MetricSample.interface_id.is_not(None), MetricSample.timestamp >= start)
    if source:
        q = q.where(MetricSample.source_mode == source)
    if location_id is not None:
        q = q.where(MetricSample.location_id == location_id)
    if device_id is not None:
        q = q.where(MetricSample.device_id == device_id)
    if interface_id is not None:
        q = q.where(MetricSample.interface_id == interface_id)
    group = [MetricSample.interface_id, b] + ([MetricSample.location_id] if by_location else [])
    sub = q.group_by(*group).subquery()
    outer = [sub.c.b] + ([sub.c.g] if by_location else [])
    return db.execute(select(*outer, func.sum(sub.c.i), func.sum(sub.c.o))
                      .group_by(*outer).order_by(sub.c.b)).all()


def gap_fill(points: list[dict], bucket_s: int) -> list[dict]:
    """Insert a null point where data is missing for a while, so charts show a gap instead of a straight line."""
    out, limit = [], max(3 * bucket_s, 300)
    for p in points:
        if out and (p["t"] - out[-1]["t"]).total_seconds() > limit:
            out.append({k: (v + timedelta(seconds=bucket_s) if k == "t" else None) for k, v in out[-1].items()})
        out.append(p)
    return out


def interface_out(i: Interface, cutoff: datetime) -> dict:
    stale = i.updated_at is None or i.updated_at < cutoff
    data = InterfaceOut.model_validate(i).model_dump()
    if stale:
        data.update(in_bps=None, out_bps=None, utilization_pct=None, stale=True)
    return data


def device_out(d: Device, cutoff: datetime) -> dict:
    ifaces = [interface_out(i, cutoff) for i in d.interfaces]
    ins = [i["in_bps"] for i in ifaces if i["in_bps"] is not None]
    outs = [i["out_bps"] for i in ifaces if i["out_bps"] is not None]
    utils = [i["utilization_pct"] for i in ifaces if i["utilization_pct"] is not None]
    status, reason = d.status, d.status_reason
    if not d.enabled:
        status, reason = "unknown", "Monitoring disabled"
    elif status == "online" and (d.last_seen_at is None or d.last_seen_at < cutoff):
        status, reason = "unknown", "No recent poll (collector inactive for this source)"
    snmp = SnmpInfo(port=d.snmp_port or 161, version=d.snmp_version or "2c", username=d.snmp_username,
                    auth_protocol=d.snmp_auth_protocol, priv_protocol=d.snmp_priv_protocol,
                    has_community=bool(d.snmp_community), has_auth_key=bool(d.snmp_auth_key),
                    has_priv_key=bool(d.snmp_priv_key)) if d.source_mode == "snmp" else None
    return DeviceOut(
        id=d.id, name=d.name, address=d.address, device_type=d.device_type, location_id=d.location_id,
        location_name=d.location.name if d.location else None, subnet=d.subnet, vlan=d.vlan,
        source_mode=d.source_mode, enabled=d.enabled, status=status, status_reason=reason,
        last_seen_at=d.last_seen_at, cpu_pct=d.cpu_pct if status == "online" else None,
        memory_pct=d.memory_pct if status == "online" else None, interface_count=len(ifaces),
        in_bps=sum(ins) if ins else None, out_bps=sum(outs) if outs else None,
        max_utilization_pct=max(utils) if utils else None, default_capacity_bps=d.default_capacity_bps,
        snmp=snmp).model_dump() | {"_interfaces": ifaces}


def devices_for(db: Session, source: str | None) -> list[Device]:
    q = select(Device).options(selectinload(Device.interfaces)).order_by(Device.name)
    if source:
        q = q.where(Device.source_mode == source)
    return list(db.scalars(q).unique())
