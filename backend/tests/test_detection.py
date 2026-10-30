"""End-to-end through the processor: counters -> rates -> detectors -> deduplicated alerts."""
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.collectors.base import CollectionResult, DeviceReading, InterfaceReading
from app.core.config import RuntimeSettings
from app.models import Alert, Device, MetricSample, utcnow
from app.services import poller

RS = RuntimeSettings(congestion_consecutive_samples=2, alert_cooldown_seconds=600, ml_enabled=False)


class Link:
    """Feeds synthetic cumulative counters for one interface at chosen rates."""

    def __init__(self, db, name, capacity):
        self.db, self.capacity = db, capacity
        self.dev = Device(name=name, address="10.99.0.1", device_type="switch", source_mode="snmp")
        db.add(self.dev)
        db.commit()
        self.t, self.in_b, self.out_b = utcnow() - timedelta(hours=1), 0, 0

    def poll(self, in_bps, out_bps=0.0, reachable=True):
        self.t += timedelta(seconds=10)
        self.in_b += int(in_bps * 10 / 8)
        self.out_b += int(out_bps * 10 / 8)
        reading = DeviceReading(self.dev.id, reachable, None if reachable else "timeout",
                                interfaces=[InterfaceReading("eth0", self.in_b, self.out_b, speed_bps=self.capacity)])
        n, _ = poller.process(self.db, "snmp", CollectionResult([reading]), self.t, RS)
        self.db.commit()
        return n

    def alerts(self, category):
        return self.db.scalars(select(Alert).where(Alert.device_id == self.dev.id, Alert.category == category)).all()


@pytest.fixture(autouse=True)
def _fresh():
    poller.reset_detectors()


def test_first_poll_has_no_rate(db):
    link = Link(db, "first-poll", 100e6)
    link.poll(10e6)
    s = db.scalars(select(MetricSample).where(MetricSample.device_id == link.dev.id)).one()
    assert s.inbound_bps is None and s.utilization_pct is None and s.inbound_bytes is not None
    link.poll(10e6)
    assert link.dev.interfaces[0].in_bps == pytest.approx(10e6, rel=1e-3)


def test_congestion_dedup_escalate_resolve_reopen(db):
    link = Link(db, "congested", 100e6)
    link.poll(10e6)
    link.poll(80e6)  # 1st sample above warning: not yet sustained
    assert link.alerts("congestion") == []
    for _ in range(3):
        link.poll(80e6)
    (a,) = link.alerts("congestion")
    assert (a.status, a.severity, a.threshold) == ("active", "warning", 70)
    assert a.observed_value == pytest.approx(80, abs=0.5) and "80.0%" in a.message

    link.poll(95e6)
    (a,) = link.alerts("congestion")  # same alert, escalated
    assert a.severity == "critical" and a.occurrences >= 4

    link.poll(10e6)
    (a,) = link.alerts("congestion")
    assert a.status == "resolved" and a.resolved_at is not None

    link.poll(85e6)
    link.poll(85e6)
    assert len(link.alerts("congestion")) == 1 and link.alerts("congestion")[0].status == "active"  # reopened


def test_unknown_capacity_never_invents_utilization(db):
    link = Link(db, "no-capacity", None)
    for _ in range(5):
        link.poll(900e6)
    assert link.dev.interfaces[0].utilization_pct is None
    assert link.alerts("congestion") == []


def test_spike_detected_with_explanation(db):
    link = Link(db, "spiky", 1e9)
    for i in range(25):
        link.poll(20e6 + (i % 3) * 1e6, 5e6)
    assert link.alerts("traffic_anomaly") == []
    link.poll(150e6, 5e6)
    (a,) = link.alerts("traffic_anomaly")
    assert a.status == "active" and a.detector == "rolling_zscore"
    assert a.baseline == pytest.approx(26e6, rel=0.1) and a.observed_value > a.threshold > a.baseline
    assert "σ above the rolling baseline" in a.message
    link.poll(21e6, 5e6)
    assert link.alerts("traffic_anomaly")[0].status == "resolved"


def test_restart_after_long_downtime_does_not_raise_false_spikes(db):
    link = Link(db, "restarted", 1e9)
    for _ in range(15):
        link.poll(20e6, 5e6)
    poller.reset_detectors()  # backend restart: in-memory baselines are gone
    link.t += timedelta(days=1)
    link.in_b += int(150e6 * 86400 / 8)
    link.out_b += int(5e6 * 86400 / 8)
    link.poll(150e6, 5e6)  # busier time of day, compared with yesterday's samples it would look like a spike
    assert link.alerts("traffic_anomaly") == []


def test_unreachable_device_marks_offline_without_zero_samples(db):
    link = Link(db, "flaky", 100e6)
    link.poll(10e6)
    before = db.scalar(select(MetricSample.id).where(MetricSample.device_id == link.dev.id).order_by(MetricSample.id.desc()))
    assert link.poll(0, reachable=False) == 0
    assert link.dev.status == "offline" and link.dev.interfaces[0].in_bps is None
    (a,) = link.alerts("device_unavailable")
    assert a.status == "active" and a.severity == "critical"  # switch = core device
    after = db.scalar(select(MetricSample.id).where(MetricSample.device_id == link.dev.id).order_by(MetricSample.id.desc()))
    assert before == after
    link.poll(10e6)
    assert link.dev.status == "online" and link.alerts("device_unavailable")[0].status == "resolved"
