"""Deterministic synthetic traffic generator. Everything it produces is labelled source_mode='demo'.

Rates are a pure function of (seed, interface key, time), so demos are reproducible. The collector emits
cumulative byte counters (last counter + rate * elapsed) so demo data flows through the same rate maths as
real collectors.
"""
import math
import random
from datetime import datetime, timezone

from app.collectors.base import CollectionResult, DeviceReading, DeviceTarget, InterfaceReading

M, G = 1e6, 1e9

LOCATIONS = [
    {"name": "Academic Block", "subnet": "192.168.10.0/24", "vlan": 10,
     "description": "Lecture halls, computer labs and faculty offices"},
    {"name": "Administration Block", "subnet": "192.168.20.0/24", "vlan": 20,
     "description": "Registrar, finance and administrative offices"},
    {"name": "Student Area", "subnet": "192.168.30.0/24", "vlan": 30,
     "description": "Hostels, common rooms and cafeteria Wi-Fi"},
    {"name": "Data Center", "subnet": "10.10.0.0/24", "vlan": 100,
     "description": "Core router, firewall and campus servers"},
]


def _if(name, alias, capacity, base_mbps, kind, out_ratio, spikes=True):
    return {"name": name, "alias": alias, "capacity": capacity,
            "profile": {"base_bps": base_mbps * M, "kind": kind, "out_ratio": out_ratio, "spikes": spikes}}


DEVICES = [
    {"name": "CORE-RTR-01", "type": "router", "ip": "10.10.0.1", "loc": "Data Center", "ifaces": [
        _if("Gi0/0", "ISP uplink", G, 380, "core", 0.35), _if("Gi0/1", "Server farm", G, 160, "academic", 1.8)]},
    {"name": "DC-FW-01", "type": "firewall", "ip": "10.10.0.254", "loc": "Data Center", "ifaces": [
        _if("dmz", "DMZ segment", G, 40, "core", 1.5)]},
    {"name": "DC-SRV-01", "type": "server", "ip": "10.10.0.10", "loc": "Data Center", "ifaces": [
        _if("eth0", "LMS server", G, 90, "academic", 3.0)]},
    {"name": "ACAD-SW-01", "type": "switch", "ip": "192.168.10.2", "loc": "Academic Block", "ifaces": [
        _if("Gi1/0/1", "Uplink to core", G, 240, "academic", 0.4), _if("Gi1/0/24", "Computer lab 1", G, 70, "academic", 0.5)]},
    {"name": "ACAD-AP-01", "type": "access_point", "ip": "192.168.10.11", "loc": "Academic Block", "ifaces": [
        _if("wlan0", "Lecture hall Wi-Fi", 300 * M, 70, "academic", 0.3)]},
    {"name": "ACAD-AP-02", "type": "access_point", "ip": "192.168.10.12", "loc": "Academic Block", "ifaces": [
        _if("wlan0", "Library Wi-Fi", 300 * M, 55, "academic", 0.3)]},
    {"name": "ACAD-LAB-PC-01", "type": "host", "ip": "192.168.10.50", "loc": "Academic Block", "ifaces": [
        _if("eth0", "Lab workstation (capacity not configured)", None, 6, "academic", 0.3, spikes=False)]},
    {"name": "ADMIN-SW-01", "type": "switch", "ip": "192.168.20.2", "loc": "Administration Block", "ifaces": [
        _if("Gi1/0/1", "Uplink to core", G, 110, "admin", 0.6)]},
    {"name": "ADMIN-AP-01", "type": "access_point", "ip": "192.168.20.11", "loc": "Administration Block", "ifaces": [
        _if("wlan0", "Office Wi-Fi", 300 * M, 35, "admin", 0.4)]},
    {"name": "ADMIN-WS-07", "type": "host", "ip": "192.168.20.57", "loc": "Administration Block", "ifaces": [
        _if("eth0", "Finance workstation (capacity not configured)", None, 4, "admin", 0.5, spikes=False)]},
    {"name": "ADMIN-PRN-01", "type": "printer", "ip": "192.168.20.40", "loc": "Administration Block",
     "meta": {"offline": True}, "ifaces": [_if("eth0", "Printer NIC", 100 * M, 1, "admin", 0.1, spikes=False)]},
    {"name": "STU-SW-01", "type": "switch", "ip": "192.168.30.2", "loc": "Student Area", "ifaces": [
        _if("Gi1/0/1", "Uplink to core", G, 330, "student", 0.3)]},
    {"name": "STU-AP-01", "type": "access_point", "ip": "192.168.30.11", "loc": "Student Area", "ifaces": [
        _if("wlan0", "Common room Wi-Fi", 300 * M, 285, "hot", 0.25, spikes=False)]},
    {"name": "STU-AP-02", "type": "access_point", "ip": "192.168.30.12", "loc": "Student Area",
     "meta": {"flap": True}, "ifaces": [_if("wlan0", "Hostel block B Wi-Fi", 300 * M, 90, "student", 0.3)]},
    {"name": "STU-AP-03", "type": "access_point", "ip": "192.168.30.13", "loc": "Student Area", "enabled": False,
     "ifaces": [_if("wlan0", "Cafeteria Wi-Fi", 300 * M, 60, "student", 0.3)]},
]

# (centre hour, width, height) bumps on top of a night-time floor; weekend multiplier
PATTERNS = {
    "academic": (0.06, [(11, 2.2, 0.9), (15, 2.0, 0.85)], 0.35),
    "admin": (0.05, [(12.5, 3.5, 0.75)], 0.25),
    "student": (0.12, [(14, 3.0, 0.55), (21, 2.5, 0.85)], 1.1),
    "core": (0.10, [(12, 3.5, 0.85), (20.5, 2.5, 0.7)], 0.7),
    "hot": (0.20, [(13, 3.5, 0.8), (20, 3.0, 0.8)], 1.0),
}
SPIKE_WINDOW_S = 1800
SPIKE_PROBABILITY = 0.05  # per eligible interface per window


def daily_factor(kind: str, local: datetime) -> float:
    floor, bumps, weekend = PATTERNS[kind]
    h = local.hour + local.minute / 60
    peak = max(height * math.exp(-((h - centre) / width) ** 2) for centre, width, height in bumps)
    if kind == "hot":  # sustained busy plateau 10:00-22:00
        peak = max(peak, 0.75 if 10 <= h < 22 else 0)
    f = floor + peak
    return floor + (f - floor) * weekend if local.weekday() >= 5 else f


def spike_multiplier(seed: int, key: str, epoch: float) -> tuple[float, str] | None:
    w = int(epoch // SPIKE_WINDOW_S)
    rng = random.Random(f"{seed}:spike:{key}:{w}")
    if rng.random() >= SPIKE_PROBABILITY:
        return None
    start = w * SPIKE_WINDOW_S + rng.uniform(0, SPIKE_WINDOW_S - 300)
    if start <= epoch < start + rng.uniform(120, 300):
        return rng.uniform(2.5, 5.0), rng.choice(["in", "out", "both"])
    return None


def demo_rates(seed: int, key: str, profile: dict, capacity: float | None, now: datetime) -> tuple[float, float]:
    """Deterministic (in_bps, out_bps) for an interface at a UTC instant."""
    epoch = now.replace(tzinfo=timezone.utc).timestamp()
    factor = daily_factor(profile["kind"], now.replace(tzinfo=timezone.utc).astimezone())
    rng = random.Random(f"{seed}:{key}:{int(epoch // 10)}")
    rin = profile["base_bps"] * factor * max(0.5, rng.gauss(1, 0.07))
    rout = rin * profile["out_ratio"] * max(0.5, rng.gauss(1, 0.07))
    if profile.get("spikes") and (spike := spike_multiplier(seed, key, epoch)):
        mult, direction = spike
        rin *= mult if direction in ("in", "both") else 1
        rout *= mult if direction in ("out", "both") else 1
    if capacity:  # a link can't carry more than its capacity
        rin, rout = min(rin, capacity * 0.985), min(rout, capacity * 0.985)
    return rin, rout


def is_offline(seed: int, target: DeviceTarget, epoch: float) -> bool:
    meta = target.meta or {}
    if meta.get("offline"):
        return True
    return bool(meta.get("flap")) and random.Random(f"{seed}:flap:{target.name}:{int(epoch // 1800)}").random() < 0.15


class DemoCollector:
    mode = "demo"

    def __init__(self, seed: int):
        self.seed = seed

    async def collect(self, targets: list[DeviceTarget], now: datetime) -> CollectionResult:
        return self.collect_sync(targets, now)

    def collect_sync(self, targets: list[DeviceTarget], now: datetime) -> CollectionResult:
        epoch = now.replace(tzinfo=timezone.utc).timestamp()
        local = now.replace(tzinfo=timezone.utc).astimezone()
        readings = []
        for t in targets:
            if is_offline(self.seed, t, epoch):
                readings.append(DeviceReading(t.id, False, "No response to polls (simulated outage)"))
                continue
            rng = random.Random(f"{self.seed}:dev:{t.name}:{int(epoch // 10)}")
            load = daily_factor("core", local)
            reading = DeviceReading(t.id, True, cpu_pct=round(min(98.0, max(1.0, 6 + 55 * load + rng.gauss(0, 4))), 1),
                                    memory_pct=round(min(97.0, 38 + 22 * load + rng.gauss(0, 2)), 1))
            for i in t.interfaces:
                profile = (i.meta or {}).get("profile")
                if not profile:
                    continue
                key = f"{t.name}/{i.name}"
                capacity = (i.meta or {}).get("capacity")
                if i.last_in_bytes is None or i.last_counter_at is None:
                    init = random.Random(f"{self.seed}:init:{key}")
                    in_b, out_b = init.randrange(10**9, 10**11), init.randrange(10**9, 10**11)
                else:
                    elapsed = max(0.0, (now - i.last_counter_at).total_seconds())
                    rin, rout = demo_rates(self.seed, key, profile, capacity, now)
                    in_b = i.last_in_bytes + round(rin * elapsed / 8)
                    out_b = i.last_out_bytes + round(rout * elapsed / 8)
                reading.interfaces.append(InterfaceReading(i.name, in_b, out_b, oper_status="up", speed_bps=capacity))
            readings.append(reading)
        return CollectionResult(readings)
