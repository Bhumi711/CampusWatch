"""Collector contract: every mode returns raw cumulative counters; the processor turns them into rates."""
from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol


@dataclass
class InterfaceTarget:
    name: str
    last_in_bytes: int | None = None
    last_out_bytes: int | None = None
    last_counter_at: datetime | None = None
    meta: dict | None = None


@dataclass
class DeviceTarget:
    id: int
    name: str
    address: str
    meta: dict | None = None
    interfaces: list[InterfaceTarget] = field(default_factory=list)
    # SNMP only
    snmp_port: int = 161
    snmp_version: str = "2c"
    snmp_community: str | None = None
    snmp_username: str | None = None
    snmp_auth_protocol: str | None = None
    snmp_auth_key: str | None = None
    snmp_priv_protocol: str | None = None
    snmp_priv_key: str | None = None


@dataclass
class InterfaceReading:
    name: str
    in_bytes: int | None
    out_bytes: int | None
    if_index: int | None = None
    oper_status: str | None = None
    speed_bps: float | None = None  # capacity reported by the device, if any
    counter_bits: int = 64


@dataclass
class DeviceReading:
    device_id: int
    reachable: bool
    error: str | None = None
    cpu_pct: float | None = None
    memory_pct: float | None = None
    interfaces: list[InterfaceReading] = field(default_factory=list)


@dataclass
class CollectionResult:
    readings: list[DeviceReading] = field(default_factory=list)
    error: str | None = None  # collector-wide failure


class Collector(Protocol):
    mode: str

    async def collect(self, targets: list[DeviceTarget], now: datetime) -> CollectionResult: ...
