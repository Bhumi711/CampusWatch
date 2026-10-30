"""Threshold congestion detection on link utilization (needs configured/reported capacity)."""
from app.core.config import RuntimeSettings
from app.models import Device, Interface
from app.services.alerts import AlertBook, fmt_bps


class CongestionDetector:
    def __init__(self):
        self.streak: dict[int, int] = {}  # consecutive samples above warning, per interface

    def reset(self):
        self.streak.clear()

    def evaluate(self, book: AlertBook, rs: RuntimeSettings, iface: Interface, device: Device,
                 util: float | None, source_mode: str) -> None:
        key = f"congestion:{iface.id}"
        if util is None:
            if not iface.capacity_bps:
                book.resolve(key)  # capacity unknown: we cannot claim congestion
            return  # missing sample: keep current state
        if util < rs.congestion_warning_pct:
            self.streak[iface.id] = 0
            book.resolve(key)
            return
        n = self.streak[iface.id] = self.streak.get(iface.id, 0) + 1
        if n < rs.congestion_consecutive_samples and not book.is_active(key):
            return
        critical = util >= rs.congestion_critical_pct
        threshold = rs.congestion_critical_pct if critical else rs.congestion_warning_pct
        busiest = max(r for r in (iface.in_bps, iface.out_bps) if r is not None)
        book.raise_(
            key, category="congestion", severity="critical" if critical else "warning", detector="threshold",
            title=f"{'Critical' if critical else 'High'} link utilization on {device.name} {iface.name}",
            message=(f"Utilization {util:.1f}% is above the {threshold:.0f}% {'critical' if critical else 'warning'} "
                     f"threshold for {n} consecutive sample(s): busiest direction {fmt_bps(busiest)} on a "
                     f"{fmt_bps(iface.capacity_bps)} link."),
            device_id=device.id, interface_id=iface.id, location_id=device.location_id,
            observed_value=round(util, 1), threshold=threshold, baseline=None, unit="%", source_mode=source_mode)
