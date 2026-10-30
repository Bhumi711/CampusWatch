"""Rule-based spike detection: deviation from a rolling per-interface baseline (z-score + ratio gates)."""
import statistics
from collections import deque
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import RuntimeSettings
from app.models import Device, Interface, MetricSample
from app.services.alerts import AlertBook, fmt_bps

MIN_BASELINE_SAMPLES = 10


class SpikeDetector:
    def __init__(self):
        self.windows: dict[int, deque] = {}
        self.flag_streak: dict[int, int] = {}

    def reset(self):
        self.windows.clear()
        self.flag_streak.clear()

    def window(self, db: Session, iface_id: int, size: int, since: datetime) -> deque:
        w = self.windows.get(iface_id)
        if w is None or w.maxlen != size:  # warm from history after restart / window change
            rows = db.execute(
                select(MetricSample.inbound_bps, MetricSample.outbound_bps)
                .where(MetricSample.interface_id == iface_id, MetricSample.inbound_bps.is_not(None),
                       MetricSample.timestamp >= since)  # after downtime, old samples are not a baseline
                .order_by(MetricSample.timestamp.desc()).limit(size)).all()
            w = self.windows[iface_id] = deque(((i or 0) + (o or 0) for i, o in reversed(rows)), maxlen=size)
        return w

    def evaluate(self, db: Session, book: AlertBook, rs: RuntimeSettings, iface: Interface, device: Device,
                 in_bps: float | None, out_bps: float | None, source_mode: str) -> tuple[float | None, float | None]:
        """Returns (z-score, baseline mean) for the sample, or (None, None) when there is no baseline yet."""
        if in_bps is None and out_bps is None:
            return None, None
        total = (in_bps or 0) + (out_bps or 0)
        horizon = max(3 * rs.anomaly_window_samples * rs.poll_interval_seconds, 3600)
        w = self.window(db, iface.id, rs.anomaly_window_samples, book.now - timedelta(seconds=horizon))
        if len(w) < MIN_BASELINE_SAMPLES:
            book.resolve(f"anomaly:{iface.id}")  # no baseline: nothing to claim
            w.append(total)
            return None, None
        mean, std = statistics.fmean(w), statistics.pstdev(w)
        sigma = max(std, 0.05 * mean, 1.0)  # floor stops near-constant links producing huge z-scores
        z = (total - mean) / sigma
        flagged = z >= rs.anomaly_zscore_threshold and total >= rs.anomaly_min_ratio * mean \
            and total >= rs.anomaly_min_bps
        key = f"anomaly:{iface.id}"
        if flagged:
            ratio = total / mean if mean else float("inf")
            book.raise_(
                key, category="traffic_anomaly", severity="critical" if ratio >= 4 else "warning",
                detector="rolling_zscore", title=f"Traffic spike on {device.name} {iface.name}",
                message=(f"Combined traffic {fmt_bps(total)} is {z:.1f}σ above the rolling baseline of "
                         f"{fmt_bps(mean)} (σ {fmt_bps(std)}, last {len(w)} samples), {ratio:.1f}× normal. "
                         f"Inbound {fmt_bps(in_bps)}, outbound {fmt_bps(out_bps)}. Thresholds: "
                         f"z ≥ {rs.anomaly_zscore_threshold:g} and ≥ {rs.anomaly_min_ratio:g}× baseline."),
                device_id=device.id, interface_id=iface.id, location_id=device.location_id,
                observed_value=total, threshold=rs.anomaly_min_ratio * mean, baseline=mean, unit="bps",
                source_mode=source_mode)
            streak = self.flag_streak[iface.id] = self.flag_streak.get(iface.id, 0) + 1
            if streak > len(w) // 2:
                w.append(total)  # sustained for half a window: accept as the new normal
        else:
            self.flag_streak[iface.id] = 0
            book.resolve(key)
            w.append(total)  # spikes stay out of the baseline
        return round(z, 2), mean
