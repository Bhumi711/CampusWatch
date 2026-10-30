"""Environment configuration (startup defaults) and runtime-editable settings."""
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_DIR = BACKEND_DIR.parent

Mode = Literal["demo", "local", "snmp"]


class EnvSettings(BaseSettings):
    """Read once from environment / .env. Values marked 'initial' only seed the runtime settings row."""

    model_config = SettingsConfigDict(env_file=(REPO_DIR / ".env", BACKEND_DIR / ".env"), extra="ignore")

    database_url: str = f"sqlite:///{BACKEND_DIR / 'data' / 'campus.db'}"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    collector_enabled: bool = True  # background polling loop (tests turn it off)
    demo_auto_seed: bool = True  # seed demo data on startup if none exists (idempotent)
    demo_seed: int = 42
    demo_history_hours: int = Field(24, ge=1, le=168)
    snmp_timeout_seconds: float = Field(2.0, gt=0, le=30)
    snmp_retries: int = Field(1, ge=0, le=5)
    # initial runtime values
    collection_mode: Mode = "demo"
    poll_interval_seconds: int = Field(10, ge=5, le=300)


env = EnvSettings()


class RuntimeSettings(BaseModel):
    """Settings editable from the UI; persisted in the app_settings table."""

    collection_mode: Mode = "demo"
    poll_interval_seconds: int = Field(10, ge=5, le=300)
    congestion_warning_pct: float = Field(70, gt=0, lt=100)
    congestion_critical_pct: float = Field(90, gt=0, le=100)
    congestion_consecutive_samples: int = Field(2, ge=1, le=20)
    anomaly_zscore_threshold: float = Field(3.0, ge=1.5, le=10)
    anomaly_min_ratio: float = Field(1.6, ge=1.0, le=20)
    anomaly_window_samples: int = Field(30, ge=10, le=500)
    anomaly_min_bps: float = Field(1_000_000, ge=0)
    ml_enabled: bool = True
    ml_contamination: float = Field(0.002, ge=0.0005, le=0.1)  # share of training samples treated as unusual
    alert_cooldown_seconds: int = Field(600, ge=0, le=86_400)
    retention_days: int = Field(7, ge=1, le=90)

    @model_validator(mode="after")
    def _check_thresholds(self):
        if self.congestion_critical_pct <= self.congestion_warning_pct:
            raise ValueError("congestion_critical_pct must be greater than congestion_warning_pct")
        return self


def initial_runtime_settings() -> RuntimeSettings:
    return RuntimeSettings(collection_mode=env.collection_mode, poll_interval_seconds=env.poll_interval_seconds)
