"""Request/response schemas. Secrets are accepted on input and never present in any output model."""
import ipaddress
import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.config import Mode, RuntimeSettings

RangeKey = Literal["15m", "1h", "6h", "24h", "7d"]
DeviceType = Literal["router", "switch", "firewall", "access_point", "server", "host", "printer", "other"]
HOSTNAME_RE = re.compile(r"^(?=.{1,253}$)([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$")


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


def _check_subnet(v: str | None) -> str | None:
    if v in (None, ""):
        return None
    try:
        return str(ipaddress.ip_network(v, strict=False))
    except ValueError as exc:
        raise ValueError(f"invalid subnet: {v}") from exc


def _check_address(v: str) -> str:
    v = v.strip()
    try:
        return str(ipaddress.ip_address(v))
    except ValueError:
        if HOSTNAME_RE.match(v):
            return v
        raise ValueError("address must be an IP address or hostname")


# ---------- locations ----------
class LocationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=80)
    subnet: str | None = None
    vlan: int | None = Field(None, ge=1, le=4094)
    description: str | None = Field(None, max_length=255)
    _subnet = field_validator("subnet")(_check_subnet)


class LocationPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(None, min_length=1, max_length=80)
    subnet: str | None = None
    vlan: int | None = Field(None, ge=1, le=4094)
    description: str | None = Field(None, max_length=255)
    _subnet = field_validator("subnet")(_check_subnet)


class LocationOut(ORM):
    id: int
    name: str
    subnet: str | None
    vlan: int | None
    description: str | None


class LocationSummary(LocationOut):
    devices_total: int
    devices_online: int
    devices_offline: int
    devices_unknown: int
    in_bps: float | None
    out_bps: float | None
    avg_total_bps: float | None
    peak_total_bps: float | None
    max_utilization_pct: float | None
    active_alerts: int


# ---------- interfaces ----------
class InterfaceOut(ORM):
    id: int
    device_id: int
    name: str
    alias: str | None
    if_index: int | None
    capacity_bps: float | None
    capacity_source: str | None
    oper_status: str | None
    counter_bits: int
    in_bps: float | None
    out_bps: float | None
    utilization_pct: float | None
    updated_at: datetime | None
    stale: bool = False


class InterfaceRow(InterfaceOut):
    device_name: str
    device_status: str
    location_id: int | None
    location_name: str | None
    source_mode: str


class InterfacePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    alias: str | None = Field(None, max_length=120)
    capacity_bps: float | None = Field(None, ge=1_000, le=1e12)  # null clears the configured capacity


# ---------- devices ----------
class SnmpInfo(BaseModel):
    port: int
    version: str
    username: str | None
    auth_protocol: str | None
    priv_protocol: str | None
    has_community: bool
    has_auth_key: bool
    has_priv_key: bool


class DeviceOut(ORM):
    id: int
    name: str
    address: str
    device_type: str
    location_id: int | None
    location_name: str | None
    subnet: str | None
    vlan: int | None
    source_mode: str
    enabled: bool
    status: str
    status_reason: str | None
    last_seen_at: datetime | None
    cpu_pct: float | None
    memory_pct: float | None
    interface_count: int
    in_bps: float | None
    out_bps: float | None
    max_utilization_pct: float | None
    default_capacity_bps: float | None
    snmp: SnmpInfo | None


class DeviceDetail(DeviceOut):
    interfaces: list[InterfaceOut]
    active_alerts: int


class _SnmpFields(BaseModel):
    snmp_port: int | None = Field(None, ge=1, le=65535)
    snmp_version: Literal["2c", "3"] | None = None
    snmp_community: str | None = Field(None, max_length=255)
    snmp_username: str | None = Field(None, max_length=255)
    snmp_auth_protocol: Literal["MD5", "SHA", "SHA256"] | None = None
    snmp_auth_key: str | None = Field(None, min_length=8, max_length=255)
    snmp_priv_protocol: Literal["DES", "AES", "AES256"] | None = None
    snmp_priv_key: str | None = Field(None, min_length=8, max_length=255)
    default_capacity_bps: float | None = Field(None, ge=1_000, le=1e12)


class DeviceCreate(_SnmpFields):
    """Creates an SNMP target. Demo and local devices are managed by their collectors."""
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=80)
    address: str
    device_type: DeviceType = "switch"
    location_id: int | None = None
    subnet: str | None = None
    vlan: int | None = Field(None, ge=1, le=4094)
    enabled: bool = True
    snmp_port: int = Field(161, ge=1, le=65535)
    snmp_version: Literal["2c", "3"] = "2c"
    _address = field_validator("address")(_check_address)
    _subnet = field_validator("subnet")(_check_subnet)

    @model_validator(mode="after")
    def _creds(self):
        if self.snmp_version == "2c" and not self.snmp_community:
            raise ValueError("SNMPv2c requires a community string")
        if self.snmp_version == "3" and not self.snmp_username:
            raise ValueError("SNMPv3 requires a username")
        if self.snmp_priv_key and not self.snmp_auth_key:
            raise ValueError("SNMPv3 privacy requires an authentication key")
        return self


class DevicePatch(_SnmpFields):
    """Omitted fields are unchanged. Secret fields are only replaced when a new non-empty value is sent."""
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(None, min_length=1, max_length=80)
    address: str | None = None
    device_type: DeviceType | None = None
    location_id: int | None = None
    subnet: str | None = None
    vlan: int | None = Field(None, ge=1, le=4094)
    enabled: bool | None = None
    _address = field_validator("address")(lambda v: v if v is None else _check_address(v))
    _subnet = field_validator("subnet")(_check_subnet)


class SnmpTestResult(BaseModel):
    reachable: bool
    error: str | None = None
    sys_descr: str | None = None
    latency_ms: float | None = None
    interfaces: int | None = None
    cpu_pct: float | None = None
    memory_pct: float | None = None


# ---------- alerts ----------
class AlertOut(ORM):
    id: int
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None
    acknowledged_at: datetime | None
    category: str
    severity: str
    status: str
    detector: str
    title: str
    message: str
    device_id: int | None
    interface_id: int | None
    location_id: int | None
    device_name: str | None = None
    interface_name: str | None = None
    location_name: str | None = None
    observed_value: float | None
    threshold: float | None
    baseline: float | None
    unit: str | None
    source_mode: str
    occurrences: int


class AlertPage(BaseModel):
    total: int
    items: list[AlertOut]


# ---------- metrics ----------
class TrafficPoint(BaseModel):
    t: datetime
    in_bps: float | None
    out_bps: float | None


class TrafficSeries(BaseModel):
    range: RangeKey
    bucket_seconds: int
    source_mode: str
    points: list[TrafficPoint]


class GroupInfo(BaseModel):
    key: str
    name: str
    avg_total_bps: float | None
    peak_total_bps: float | None
    avg_in_bps: float | None
    avg_out_bps: float | None


class GroupedSeries(BaseModel):
    range: RangeKey
    bucket_seconds: int
    source_mode: str
    groups: list[GroupInfo]
    points: list[dict]  # {"t": iso, "<group key>": total bps | null}


class TopItem(BaseModel):
    interface_id: int | None = None
    device_id: int
    name: str
    device_name: str
    location_name: str | None
    avg_in_bps: float | None
    avg_out_bps: float | None
    peak_total_bps: float | None
    max_utilization_pct: float | None
    est_bytes: float | None  # avg rate x covered time, an estimate


class DeviceMetrics(BaseModel):
    range: RangeKey
    bucket_seconds: int
    interfaces: list[dict]  # [{interface_id, name, points:[{t,in_bps,out_bps,utilization_pct}]}]
    system: list[dict]  # [{t, cpu_pct, memory_pct}]


# ---------- summary / collector / settings ----------
class Summary(BaseModel):
    source_mode: str
    synthetic: bool
    generated_at: datetime
    devices: dict
    traffic: dict
    utilization: dict
    alerts: dict


class SettingsOut(RuntimeSettings):
    modes: list[Mode] = ["demo", "local", "snmp"]
    demo_seed: int
    demo_history_hours: int
    snmp_timeout_seconds: float
    snmp_retries: int


class SettingsPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    collection_mode: Mode | None = None
    poll_interval_seconds: int | None = None
    congestion_warning_pct: float | None = None
    congestion_critical_pct: float | None = None
    congestion_consecutive_samples: int | None = None
    anomaly_zscore_threshold: float | None = None
    anomaly_min_ratio: float | None = None
    anomaly_window_samples: int | None = None
    anomaly_min_bps: float | None = None
    ml_enabled: bool | None = None
    ml_contamination: float | None = None
    alert_cooldown_seconds: int | None = None
    retention_days: int | None = None
