"""Poll cycle: collect raw counters -> rates/utilization -> samples -> detectors -> alerts. Plus the background loop."""
import asyncio
import logging
from datetime import datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.collectors.base import CollectionResult, DeviceTarget, InterfaceTarget
from app.collectors.demo import DemoCollector
from app.collectors.local import LOCAL_DEVICE_ADDRESS, LocalCollector, local_hostname
from app.core.config import RuntimeSettings, env
from app.db.session import SessionLocal
from app.detection.anomaly import SpikeDetector
from app.detection.congestion import CongestionDetector
from app.detection.ml import IsolationForestDetector
from app.models import Alert, CollectorRun, Device, Interface, MetricSample, utcnow
from app.services.alerts import AlertBook, fmt_bps
from app.services.rates import compute_rate, utilization
from app.services.settings_store import get_settings

log = logging.getLogger("campus.poller")

congestion = CongestionDetector()
spikes = SpikeDetector()
ml = IsolationForestDetector()
CORE_TYPES = ("router", "switch", "firewall")


def reset_detectors() -> None:
    congestion.reset()
    spikes.reset()
    ml.reset()


def get_collector(mode: str):
    if mode == "demo":
        return DemoCollector(env.demo_seed)
    if mode == "local":
        return LocalCollector()
    from app.collectors.snmp import SnmpCollector  # pysnmp import is slow; load only when needed
    return SnmpCollector()


def ensure_local_device(db: Session) -> Device:
    dev = db.scalars(select(Device).where(Device.source_mode == "local")).first()
    if dev is None:
        dev = Device(name=f"{local_hostname()} (this computer)", address=LOCAL_DEVICE_ADDRESS, device_type="host",
                     source_mode="local")
        db.add(dev)
        db.commit()
    return dev


def to_target(d: Device) -> DeviceTarget:
    return DeviceTarget(
        id=d.id, name=d.name, address=d.address, meta=d.meta,
        interfaces=[InterfaceTarget(i.name, i.last_in_bytes, i.last_out_bytes, i.last_counter_at, i.meta)
                    for i in d.interfaces],
        snmp_port=d.snmp_port or 161, snmp_version=d.snmp_version or "2c", snmp_community=d.snmp_community,
        snmp_username=d.snmp_username, snmp_auth_protocol=d.snmp_auth_protocol, snmp_auth_key=d.snmp_auth_key,
        snmp_priv_protocol=d.snmp_priv_protocol, snmp_priv_key=d.snmp_priv_key)


def build_targets(db: Session, mode: str) -> list[DeviceTarget]:
    if mode == "local":
        ensure_local_device(db)
    devices = db.scalars(select(Device).where(Device.source_mode == mode, Device.enabled.is_(True))).unique().all()
    return [to_target(d) for d in devices]


def process(db: Session, mode: str, result: CollectionResult, now: datetime, rs: RuntimeSettings,
            book: AlertBook | None = None) -> tuple[int, list]:
    """Persist one collection result. Returns (samples written, per-device failures).
    A long-lived book may be passed when this session is the only alert writer (seeding backfill)."""
    book = book or AlertBook(db, now, rs.alert_cooldown_seconds)
    book.now = now
    samples, scored, failures = [], [], []

    if result.error:
        book.raise_(f"collector:{mode}", category="collector_error", severity="warning", detector="collector",
                    title=f"{mode.upper()} collector error", message=result.error, source_mode=mode,
                    device_id=None, interface_id=None, location_id=None)
    else:
        book.resolve(f"collector:{mode}")

    for r in result.readings:
        dev = db.get(Device, r.device_id)
        if dev is None:
            continue
        akey = f"device:{dev.id}"
        if not r.reachable:
            dev.status, dev.status_reason = "offline", r.error
            for i in dev.interfaces:
                i.in_bps = i.out_bps = i.utilization_pct = None
            book.raise_(akey, category="device_unavailable", detector="availability",
                        severity="critical" if dev.device_type in CORE_TYPES else "warning",
                        title=f"{dev.name} is unreachable",
                        message=(f"{dev.name} ({dev.address}) did not respond to the {mode} collector: {r.error}. "
                                 "Its metrics are shown as unavailable, not zero."),
                        device_id=dev.id, interface_id=None, location_id=dev.location_id, source_mode=mode)
            failures.append({"device_id": dev.id, "device": dev.name, "error": r.error})
            continue

        dev.status, dev.status_reason, dev.last_seen_at = "online", r.error, now
        dev.cpu_pct, dev.memory_pct = r.cpu_pct, r.memory_pct
        book.resolve(akey)
        if r.cpu_pct is not None or r.memory_pct is not None:
            samples.append(MetricSample(timestamp=now, device_id=dev.id, location_id=dev.location_id, source_mode=mode,
                                        cpu_pct=r.cpu_pct, memory_pct=r.memory_pct))

        by_name = {i.name: i for i in dev.interfaces}
        for ir in r.interfaces:
            iface = by_name.get(ir.name)
            if iface is None:
                iface = by_name[ir.name] = Interface(device=dev, name=ir.name)
                db.add(iface)
                db.flush()
            iface.if_index, iface.oper_status, iface.counter_bits = ir.if_index, ir.oper_status, ir.counter_bits
            if iface.capacity_source != "configured":  # user-set capacity always wins
                cap = ir.speed_bps or dev.default_capacity_bps
                iface.capacity_bps = cap
                iface.capacity_source = "reported" if ir.speed_bps else ("device default" if cap else None)

            elapsed = (now - iface.last_counter_at).total_seconds() if iface.last_counter_at else None
            rin = compute_rate(iface.last_in_bytes, ir.in_bytes, elapsed, ir.counter_bits)
            rout = compute_rate(iface.last_out_bytes, ir.out_bytes, elapsed, ir.counter_bits)
            if iface.capacity_bps:  # >110% of capacity means a misread counter (e.g. reset seen as wrap)
                rin = None if rin is not None and rin > 1.1 * iface.capacity_bps else rin
                rout = None if rout is not None and rout > 1.1 * iface.capacity_bps else rout
            util = utilization(rin, rout, iface.capacity_bps)
            iface.last_in_bytes, iface.last_out_bytes, iface.last_counter_at = ir.in_bytes, ir.out_bytes, now
            iface.in_bps, iface.out_bps, iface.utilization_pct, iface.updated_at = rin, rout, util, now

            congestion.evaluate(book, rs, iface, dev, util, mode)
            z, baseline = spikes.evaluate(db, book, rs, iface, dev, rin, rout, mode)
            s = MetricSample(timestamp=now, device_id=dev.id, interface_id=iface.id, location_id=dev.location_id,
                             source_mode=mode, inbound_bytes=ir.in_bytes, outbound_bytes=ir.out_bytes,
                             inbound_bps=rin, outbound_bps=rout, utilization_pct=util, anomaly_score=z)
            samples.append(s)
            scored.append({"sample": s, "iface": iface, "dev": dev, "iface_id": iface.id, "loc_id": dev.location_id,
                           "in": rin, "out": rout, "rolling_mean": baseline})

    if rs.ml_enabled and ml.model is not None and ml.source_mode == mode and scored:
        _apply_ml(book, rs, mode, scored, now)
    db.add_all(samples)
    return len(samples), failures


def _apply_ml(book: AlertBook, rs: RuntimeSettings, mode: str, items: list[dict], now: datetime) -> None:
    threshold = ml.threshold(rs.ml_contamination)
    for it, score in zip(items, ml.score(items, now)):
        it["sample"].ml_score = score
        if score is None:
            continue
        iface, dev, key = it["iface"], it["dev"], f"ml:{it['iface_id']}"
        if score < threshold or book.is_active(f"anomaly:{iface.id}"):
            book.resolve(key)  # below threshold, or already explained by the rule-based detector
            continue
        med_in, med_out = ml.medians[iface.id]
        book.raise_(
            key, category="traffic_anomaly", severity="info", detector="isolation_forest",
            title=f"Unusual traffic pattern on {dev.name} {iface.name}",
            message=(f"Isolation Forest score {score:.3f} is above {threshold:.3f}, the score only "
                     f"{rs.ml_contamination:.2%} of training samples exceed. Inbound {fmt_bps(it['in'])} / "
                     f"outbound {fmt_bps(it['out'])} vs typical {fmt_bps(med_in)} / {fmt_bps(med_out)} for this "
                     f"interface; rolling baseline {fmt_bps(it['rolling_mean'])}. {ml.last_message}"),
            device_id=dev.id, interface_id=iface.id, location_id=dev.location_id, observed_value=score,
            threshold=threshold, baseline=None, unit="score", source_mode=mode)


def purge_old(db: Session, retention_days: int) -> None:
    cutoff = utcnow() - timedelta(days=retention_days)
    db.execute(delete(MetricSample).where(MetricSample.timestamp < cutoff))
    db.execute(delete(CollectorRun).where(CollectorRun.started_at < cutoff))
    db.execute(delete(Alert).where(Alert.status == "resolved", Alert.resolved_at < cutoff))
    db.commit()


class Poller:
    def __init__(self):
        self.lock = asyncio.Lock()
        self.wake = asyncio.Event()
        self.task: asyncio.Task | None = None
        self.next_poll_at: datetime | None = None
        self._last_train_try: datetime | None = None
        self._last_purge: datetime | None = None

    @property
    def running(self) -> bool:
        return self.task is not None and not self.task.done()

    def _prepare(self) -> tuple[str, list[DeviceTarget], datetime]:
        with SessionLocal() as db:
            mode = get_settings(db).collection_mode
            return mode, build_targets(db, mode), utcnow()

    def _finish(self, mode, targets, result, started, trigger) -> int:
        with SessionLocal() as db:
            rs = get_settings(db)
            written, failures = process(db, mode, result, started, rs)
            all_failed = bool(targets) and len(failures) == len(targets)
            run = CollectorRun(mode=mode, trigger=trigger, started_at=started, finished_at=utcnow(),
                               success=result.error is None and not all_failed,
                               error=result.error or (f"All {len(targets)} {mode} targets failed" if all_failed else None),
                               devices_polled=len(targets), devices_failed=len(failures), samples_written=written,
                               details=failures or None)
            db.add(run)
            db.commit()
            return run.id

    async def poll_once(self, trigger: str = "schedule") -> int:
        async with self.lock:
            mode, targets, started = await asyncio.to_thread(self._prepare)
            try:
                result = await get_collector(mode).collect(targets, started)
            except Exception as exc:  # never let a collector crash the app
                log.exception("collector %s failed", mode)
                result = CollectionResult(error=f"{type(exc).__name__}: {exc}")
            return await asyncio.to_thread(self._finish, mode, targets, result, started, trigger)

    def housekeeping(self) -> None:
        now = utcnow()
        with SessionLocal() as db:
            rs = get_settings(db)
            stale = ml.model is None or ml.source_mode != rs.collection_mode or now - ml.trained_at > timedelta(hours=1)
            if rs.ml_enabled and stale and (self._last_train_try is None
                                            or now - self._last_train_try > timedelta(minutes=5)):
                self._last_train_try = now
                ml.train(db, rs.collection_mode)
            if self._last_purge is None or now - self._last_purge > timedelta(hours=1):
                self._last_purge = now
                purge_old(db, rs.retention_days)

    @staticmethod
    def _interval() -> int:
        with SessionLocal() as db:
            return get_settings(db).poll_interval_seconds

    async def run_forever(self) -> None:
        while True:
            try:
                await self.poll_once()
                await asyncio.to_thread(self.housekeeping)
            except Exception:
                log.exception("poll cycle failed")
            interval = await asyncio.to_thread(self._interval)
            self.next_poll_at = utcnow() + timedelta(seconds=interval)
            try:
                await asyncio.wait_for(self.wake.wait(), timeout=interval)
            except asyncio.TimeoutError:
                pass
            self.wake.clear()

    def start(self) -> None:
        self.task = asyncio.create_task(self.run_forever())

    async def stop(self) -> None:
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass


poller = Poller()
