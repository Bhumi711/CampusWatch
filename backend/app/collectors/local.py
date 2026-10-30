"""Real counters from this machine's network interfaces via psutil."""
import socket
from datetime import datetime

import psutil

from app.collectors.base import CollectionResult, DeviceReading, DeviceTarget, InterfaceReading

LOCAL_DEVICE_ADDRESS = "127.0.0.1"
# loopback + macOS virtual/tunnel interfaces that would only add idle noise
SKIP_PREFIXES = ("lo", "utun", "awdl", "llw", "anpi", "gif", "stf", "ap", "bridge")
psutil.cpu_percent(interval=None)  # prime: the first call always returns a meaningless 0.0


def local_hostname() -> str:
    return socket.gethostname().split(".")[0][:60] or "localhost"


class LocalCollector:
    mode = "local"

    async def collect(self, targets: list[DeviceTarget], now: datetime) -> CollectionResult:
        try:
            counters = psutil.net_io_counters(pernic=True)
            stats = psutil.net_if_stats()
            cpu = psutil.cpu_percent(interval=None)
            mem = psutil.virtual_memory().percent
        except Exception as exc:  # psutil can fail in restricted sandboxes
            return CollectionResult(error=f"psutil failed: {exc}")
        ifaces = []
        for name, c in sorted(counters.items()):
            st = stats.get(name)
            if name.startswith(SKIP_PREFIXES) or st is None or not st.isup or not (c.bytes_recv or c.bytes_sent):
                continue  # skip loopback/virtual, down and never-used interfaces
            ifaces.append(InterfaceReading(
                name, c.bytes_recv, c.bytes_sent, oper_status="up",
                speed_bps=st.speed * 1e6 if st.speed and st.speed > 0 else None))  # speed 0 = unknown (common on Wi-Fi)
        return CollectionResult([DeviceReading(t.id, True, cpu_pct=cpu, memory_pct=mem, interfaces=ifaces)
                                 for t in targets])
