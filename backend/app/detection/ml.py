"""Optional Isolation Forest detector. Only scores once trained on enough history for the active source mode."""
import math
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import MetricSample, utcnow

MIN_TRAINING_SAMPLES = 300
ROLLING = 30
LOCAL_TZ = datetime.now().astimezone().tzinfo


class IsolationForestDetector:
    def __init__(self):
        self.reset()

    def reset(self):
        self.model = None
        self.trained_at: datetime | None = None
        self.source_mode: str | None = None
        self.n_samples = 0
        self.medians: dict[int, tuple[float, float]] = {}
        self.locations: list[int] = []
        self.train_scores = np.empty(0)
        self.last_message = "Not trained yet."

    def threshold(self, contamination: float) -> float | None:
        """Score above which a sample is rarer than `contamination` of the training data."""
        return float(np.quantile(self.train_scores, 1 - contamination)) if self.train_scores.size else None

    def _features(self, iface_ids, loc_ids, ins, outs, rolling_means, hours) -> np.ndarray:
        med = np.array([self.medians[i] for i in iface_ids], dtype=float).reshape(-1, 2)
        ins, outs, rm = (np.asarray(x, dtype=float) for x in (ins, outs, rolling_means))
        hours = np.asarray(hours, dtype=float)
        cols = [np.log1p(ins) - np.log1p(med[:, 0]), np.log1p(outs) - np.log1p(med[:, 1]),
                np.log1p(ins + outs) - np.log1p(rm),
                np.sin(2 * math.pi * hours / 24), np.cos(2 * math.pi * hours / 24)]
        loc = np.asarray(loc_ids, dtype=float)
        cols += [(loc == c).astype(float) for c in self.locations]  # one-hot campus area
        return np.column_stack(cols)

    def train(self, db: Session, source_mode: str) -> None:
        from sklearn.ensemble import IsolationForest

        since = utcnow() - timedelta(days=7)
        rows = db.execute(
            select(MetricSample.timestamp, MetricSample.interface_id, MetricSample.location_id,
                   MetricSample.inbound_bps, MetricSample.outbound_bps)
            .where(MetricSample.source_mode == source_mode, MetricSample.interface_id.is_not(None),
                   MetricSample.inbound_bps.is_not(None), MetricSample.outbound_bps.is_not(None),
                   MetricSample.timestamp >= since)
            .order_by(MetricSample.timestamp.desc()).limit(80_000)).all()
        if len(rows) < MIN_TRAINING_SAMPLES:
            self.reset()
            self.last_message = (f"Not trained: need at least {MIN_TRAINING_SAMPLES} {source_mode} traffic samples, "
                                 f"have {len(rows)}. The rule-based detector is active meanwhile.")
            return
        df = pd.DataFrame(rows, columns=["ts", "iface", "loc", "in", "out"]).sort_values("ts")
        df["loc"] = df["loc"].fillna(-1)
        df["total"] = df["in"] + df["out"]
        df["rm"] = df.groupby("iface")["total"].transform(lambda s: s.shift(1).rolling(ROLLING, min_periods=5).mean())
        df = df.dropna(subset=["rm"])
        local = pd.to_datetime(df["ts"], utc=True).dt.tz_convert(LOCAL_TZ)
        df["hour"] = local.dt.hour + local.dt.minute / 60
        med = df.groupby("iface")[["in", "out"]].median()
        self.medians = {int(i): (float(r["in"]), float(r["out"])) for i, r in med.iterrows()}
        self.locations = sorted(int(x) for x in df["loc"].unique())
        X = self._features(df["iface"], df["loc"], df["in"], df["out"], df["rm"], df["hour"])
        self.model = IsolationForest(n_estimators=150, random_state=42).fit(X)
        self.train_scores = -self.model.score_samples(X)
        self.trained_at, self.source_mode, self.n_samples = utcnow(), source_mode, len(df)
        self.last_message = (f"Trained on {len(df)} {source_mode} samples"
                             + (" of SYNTHETIC demo traffic: it has learned simulated patterns, not real campus usage."
                                if source_mode == "demo" else "."))
        return None

    def score(self, items: list[dict], now: datetime) -> list[float | None]:
        """items: {iface_id, loc_id, in, out, rolling_mean}. Unknown interfaces / no baseline -> None."""
        if self.model is None:
            return [None] * len(items)
        ok = [i for i, it in enumerate(items) if it["iface_id"] in self.medians and it["rolling_mean"]
              and it["in"] is not None and it["out"] is not None]
        out: list[float | None] = [None] * len(items)
        if ok:
            local = now.replace(tzinfo=timezone.utc).astimezone(LOCAL_TZ)
            hour = local.hour + local.minute / 60
            X = self._features([items[i]["iface_id"] for i in ok], [items[i]["loc_id"] or -1 for i in ok],
                               [items[i]["in"] for i in ok], [items[i]["out"] for i in ok],
                               [items[i]["rolling_mean"] for i in ok], [hour] * len(ok))
            for i, s in zip(ok, -self.model.score_samples(X)):
                out[i] = round(float(s), 3)
        return out

    def status(self, enabled: bool, contamination: float) -> dict:
        return {"enabled": enabled, "trained": self.model is not None, "trained_at": self.trained_at,
                "contamination": contamination, "score_threshold": self.threshold(contamination),
                "training_samples": self.n_samples, "source_mode": self.source_mode,
                "synthetic": self.source_mode == "demo", "min_training_samples": MIN_TRAINING_SAMPLES,
                "features": ["inbound vs interface median", "outbound vs interface median",
                             "total vs rolling mean", "time of day (sin/cos)", "campus area (one-hot)"],
                "message": self.last_message if enabled else "Disabled in settings."}
