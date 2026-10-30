"""Alert lifecycle with deduplication (one active alert per key) and cooldown (re-open instead of re-create)."""
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Alert

SEVERITY_RANK = {"info": 0, "warning": 1, "critical": 2}


class AlertBook:
    """Loaded once per poll so detectors don't query per sample."""

    def __init__(self, db: Session, now: datetime, cooldown_s: int):
        self.db, self.now, self.cooldown = db, now, timedelta(seconds=cooldown_s)
        self.active = {a.dedup_key: a for a in db.scalars(
            select(Alert).where(Alert.status == "active", Alert.dedup_key.is_not(None)))}
        self.recent = {a.dedup_key: a for a in db.scalars(
            select(Alert).where(Alert.status == "resolved", Alert.dedup_key.is_not(None),
                                Alert.resolved_at >= now - timedelta(seconds=cooldown_s))
            .order_by(Alert.resolved_at))}

    def raise_(self, key: str, **fields) -> Alert:
        alert = self.active.get(key)
        recent = self.recent.get(key)
        if alert is None and recent is not None and recent.resolved_at >= self.now - self.cooldown:
            alert = self.recent.pop(key)
            alert.status, alert.resolved_at = "active", None  # within cooldown: reopen
        if alert is not None:
            if SEVERITY_RANK[fields["severity"]] > SEVERITY_RANK[alert.severity]:
                alert.acknowledged_at = None  # escalation needs fresh attention
            for k, v in fields.items():
                setattr(alert, k, v)
            alert.updated_at = self.now
            alert.occurrences += 1
        else:
            alert = Alert(dedup_key=key, created_at=self.now, updated_at=self.now, status="active", occurrences=1,
                          **fields)
            self.db.add(alert)
        self.active[key] = alert
        return alert

    def resolve(self, key: str) -> None:
        alert = self.active.pop(key, None)
        if alert is not None:
            alert.status, alert.resolved_at, alert.updated_at = "resolved", self.now, self.now
            self.recent[key] = alert

    def is_active(self, key: str) -> bool:
        return key in self.active


def fmt_bps(v: float | None) -> str:
    if v is None:
        return "n/a"
    for unit, div in (("Gbps", 1e9), ("Mbps", 1e6), ("Kbps", 1e3)):
        if abs(v) >= div:
            return f"{v / div:.1f} {unit}"
    return f"{v:.0f} bps"
