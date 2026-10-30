"""SQLAlchemy ORM models. Timestamps are stored as naive UTC and loaded as timezone-aware UTC."""
from datetime import datetime, timezone

from sqlalchemy import (JSON, BigInteger, Boolean, DateTime, Float, ForeignKey, Index, Integer, String,
                        TypeDecorator, UniqueConstraint)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UTCDateTime(TypeDecorator):
    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value, dialect):
        return value.astimezone(timezone.utc).replace(tzinfo=None) if value is not None and value.tzinfo else value

    def process_result_value(self, value, dialect):
        return value.replace(tzinfo=timezone.utc) if value is not None else value


class Location(Base):
    __tablename__ = "locations"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    subnet: Mapped[str | None] = mapped_column(String(43))
    vlan: Mapped[int | None] = mapped_column(Integer)
    description: Mapped[str | None] = mapped_column(String(255))


class Device(Base):
    __tablename__ = "devices"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    address: Mapped[str] = mapped_column(String(255))
    device_type: Mapped[str] = mapped_column(String(20), default="other")
    location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id", ondelete="SET NULL"), index=True)
    subnet: Mapped[str | None] = mapped_column(String(43))
    vlan: Mapped[int | None] = mapped_column(Integer)
    source_mode: Mapped[str] = mapped_column(String(10), index=True)  # demo | local | snmp
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(10), default="unknown")  # online | offline | unknown
    status_reason: Mapped[str | None] = mapped_column(String(500))
    last_seen_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    cpu_pct: Mapped[float | None] = mapped_column(Float)
    memory_pct: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    # SNMP target config. Secrets (community / keys) are write-only via the API.
    snmp_port: Mapped[int | None] = mapped_column(Integer)
    snmp_version: Mapped[str | None] = mapped_column(String(3))  # 2c | 3
    snmp_community: Mapped[str | None] = mapped_column(String(255))
    snmp_username: Mapped[str | None] = mapped_column(String(255))
    snmp_auth_protocol: Mapped[str | None] = mapped_column(String(10))
    snmp_auth_key: Mapped[str | None] = mapped_column(String(255))
    snmp_priv_protocol: Mapped[str | None] = mapped_column(String(10))
    snmp_priv_key: Mapped[str | None] = mapped_column(String(255))
    default_capacity_bps: Mapped[float | None] = mapped_column(Float)
    meta: Mapped[dict | None] = mapped_column(JSON)  # demo profile (offline/flapping)

    location: Mapped[Location | None] = relationship(lazy="joined")
    interfaces: Mapped[list["Interface"]] = relationship(
        back_populates="device", cascade="all, delete-orphan", passive_deletes=True, order_by="Interface.id")


class Interface(Base):
    __tablename__ = "interfaces"
    __table_args__ = (UniqueConstraint("device_id", "name"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    device_id: Mapped[int] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    alias: Mapped[str | None] = mapped_column(String(120))
    if_index: Mapped[int | None] = mapped_column(Integer)
    capacity_bps: Mapped[float | None] = mapped_column(Float)
    capacity_source: Mapped[str | None] = mapped_column(String(12))  # configured | reported
    oper_status: Mapped[str | None] = mapped_column(String(16))
    counter_bits: Mapped[int] = mapped_column(Integer, default=64)
    last_in_bytes: Mapped[int | None] = mapped_column(BigInteger)
    last_out_bytes: Mapped[int | None] = mapped_column(BigInteger)
    last_counter_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    in_bps: Mapped[float | None] = mapped_column(Float)
    out_bps: Mapped[float | None] = mapped_column(Float)
    utilization_pct: Mapped[float | None] = mapped_column(Float)
    updated_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    meta: Mapped[dict | None] = mapped_column(JSON)  # demo traffic profile

    device: Mapped[Device] = relationship(back_populates="interfaces")


class MetricSample(Base):
    __tablename__ = "metric_samples"
    __table_args__ = (
        Index("ix_samples_iface_ts", "interface_id", "timestamp"),
        Index("ix_samples_device_ts", "device_id", "timestamp"),
        Index("ix_samples_source_ts", "source_mode", "timestamp"),
        Index("ix_samples_location_ts", "location_id", "timestamp"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    timestamp: Mapped[datetime] = mapped_column(UTCDateTime)
    device_id: Mapped[int] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"))
    interface_id: Mapped[int | None] = mapped_column(ForeignKey("interfaces.id", ondelete="CASCADE"))
    location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id", ondelete="SET NULL"))
    source_mode: Mapped[str] = mapped_column(String(10))
    inbound_bytes: Mapped[int | None] = mapped_column(BigInteger)
    outbound_bytes: Mapped[int | None] = mapped_column(BigInteger)
    inbound_bps: Mapped[float | None] = mapped_column(Float)
    outbound_bps: Mapped[float | None] = mapped_column(Float)
    utilization_pct: Mapped[float | None] = mapped_column(Float)
    cpu_pct: Mapped[float | None] = mapped_column(Float)
    memory_pct: Mapped[float | None] = mapped_column(Float)
    anomaly_score: Mapped[float | None] = mapped_column(Float)  # rolling z-score
    ml_score: Mapped[float | None] = mapped_column(Float)  # Isolation Forest score (higher = more unusual)


class Alert(Base):
    __tablename__ = "alerts"
    __table_args__ = (Index("ix_alerts_key_status", "dedup_key", "status"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, index=True)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime)
    resolved_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    acknowledged_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    category: Mapped[str] = mapped_column(String(24), index=True)  # congestion | traffic_anomaly | device_unavailable | collector_error
    severity: Mapped[str] = mapped_column(String(10), index=True)  # info | warning | critical
    status: Mapped[str] = mapped_column(String(10), default="active", index=True)  # active | resolved
    detector: Mapped[str] = mapped_column(String(24))
    title: Mapped[str] = mapped_column(String(200))
    message: Mapped[str] = mapped_column(String(1000))
    device_id: Mapped[int | None] = mapped_column(ForeignKey("devices.id", ondelete="SET NULL"))
    interface_id: Mapped[int | None] = mapped_column(ForeignKey("interfaces.id", ondelete="SET NULL"))
    location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id", ondelete="SET NULL"))
    observed_value: Mapped[float | None] = mapped_column(Float)
    threshold: Mapped[float | None] = mapped_column(Float)
    baseline: Mapped[float | None] = mapped_column(Float)
    unit: Mapped[str | None] = mapped_column(String(10))
    source_mode: Mapped[str] = mapped_column(String(10), index=True)
    dedup_key: Mapped[str | None] = mapped_column(String(120))
    occurrences: Mapped[int] = mapped_column(Integer, default=1)


class CollectorRun(Base):
    __tablename__ = "collector_runs"
    id: Mapped[int] = mapped_column(primary_key=True)
    mode: Mapped[str] = mapped_column(String(10), index=True)
    trigger: Mapped[str] = mapped_column(String(12), default="schedule")
    started_at: Mapped[datetime] = mapped_column(UTCDateTime, index=True)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    success: Mapped[bool] = mapped_column(Boolean, default=False)
    error: Mapped[str | None] = mapped_column(String(500))
    devices_polled: Mapped[int] = mapped_column(Integer, default=0)
    devices_failed: Mapped[int] = mapped_column(Integer, default=0)
    samples_written: Mapped[int] = mapped_column(Integer, default=0)
    details: Mapped[list | None] = mapped_column(JSON)  # [{device_id, device, error}]


class AppSetting(Base):
    __tablename__ = "app_settings"
    id: Mapped[int] = mapped_column(primary_key=True)
    data: Mapped[dict] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
