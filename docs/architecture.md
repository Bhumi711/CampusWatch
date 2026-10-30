# Architecture

## Overview

```text
 Cisco Packet Tracer / reachable SNMP devices / this laptop / demo generator
                                  │
         ┌────────────────────────┼─────────────────────────┐
         │ DemoCollector          │ LocalCollector          │ SnmpCollector
         │ (seeded, synthetic)    │ (psutil counters)       │ (pysnmp v2c/v3, IF-MIB)
         └────────────────────────┼─────────────────────────┘
                                  ▼   raw cumulative byte counters + reachability
                   Processor  (backend/app/services/poller.py)
          counter deltas → bps · utilization (only with capacity) · samples
                                  │
              ┌───────────────────┼───────────────────────┐
              ▼                   ▼                       ▼
   CongestionDetector     SpikeDetector (rules)   IsolationForest (optional)
   threshold + streak     rolling z-score + ratio   trained on stored history
              └───────────┬───────┴───────────────────────┘
                          ▼
              AlertBook: dedup per key, cooldown re-open, auto-resolve
                          │
                          ▼
                SQLite (SQLAlchemy 2, WAL mode)
                          │
                          ▼
              FastAPI REST  /health · /api/v1/*
                          │   (Vite dev server proxies /api)
                          ▼
        React + TypeScript dashboard (Vite, Tailwind v4, Recharts)
```

Every collector returns the same shape (`CollectionResult` of `DeviceReading`s with cumulative counters), so
demo data goes through exactly the same rate maths, detectors and alert logic as live data. Seeded history is
produced by running the demo collector over past timestamps through the real processor — seeded alerts are
genuine detector output on synthetic traffic, not hand-written rows.

## Backend modules (`backend/app`)

| Module | Responsibility |
|---|---|
| `core/config.py` | `EnvSettings` (env / `.env`, startup defaults) and `RuntimeSettings` (validated, UI-editable, persisted in `app_settings`) |
| `db/session.py` | Engine (SQLite pragmas: WAL, foreign keys, busy timeout), sessions, `init_db()` (safe `create_all`) |
| `models/` | `Location`, `Device`, `Interface`, `MetricSample`, `Alert`, `CollectorRun`, `AppSetting` |
| `schemas/` | Pydantic request/response models; SNMP secrets are input-only |
| `collectors/` | `base.py` contract, `demo.py`, `local.py`, `snmp.py` |
| `services/rates.py` | `compute_rate()` and `utilization()` — the only place rates are derived |
| `services/poller.py` | Poll cycle (`process()`), background loop, housekeeping (ML retrain, retention purge) |
| `services/alerts.py` | `AlertBook`: one active alert per dedup key, cooldown re-open, escalation clears acknowledgement |
| `services/seed.py` | Idempotent demo seed / clear / reset |
| `detection/` | `congestion.py`, `anomaly.py` (rule-based), `ml.py` (Isolation Forest) |
| `api/` | Routers: `system.py`, `metrics.py`, `inventory.py`, `alerts.py`, shared query helpers in `common.py` |

### Rate calculation

`rate_bps = (current_bytes − previous_bytes) × 8 / elapsed_seconds`

* First poll of an interface → no rate (needs a previous reading); the sample stores the counter only.
* `elapsed ≤ 0` or missing counter → unavailable (`null`).
* Negative delta on a 64-bit counter → treated as a reset (device reboot) → unavailable for that interval.
* Negative delta on a 32-bit SNMP counter → one wrap (`+2³²`).
* A rate above 110 % of a known capacity → discarded as a misread counter.
* Unreachable device → no sample written; current rates set to `null` (never zero).
* Interfaces with no sample for ~3 poll intervals are shown as *stale* and their rates as unavailable.

Utilization = busiest direction ÷ capacity (full-duplex links). It is only computed when capacity is known:
configured by the user (wins), reported by the device (`ifHighSpeed`/`ifSpeed`, psutil speed), or the SNMP
target's optional default capacity.

### Detection

* **Congestion** — warning ≥ 70 %, critical ≥ 90 % (configurable) for N consecutive samples (default 2).
  One alert per interface (`congestion:<id>`); severity escalates in place; resolves when utilization drops
  below the warning threshold; re-opens instead of duplicating within the cooldown (default 10 min).
* **Traffic spikes (rule-based, always on)** — per interface rolling window of the last 30 totals (in+out).
  A sample is flagged when `z ≥ 3` **and** `total ≥ 1.6 × baseline` **and** `total ≥ 1 Mbps`.
  σ is floored at 5 % of the mean so near-constant links don't produce absurd z-scores. Flagged samples are kept
  out of the baseline unless the level persists for half a window (accepted as the new normal). The alert stores
  observed value, baseline and threshold and explains the numbers.
* **Isolation Forest (optional)** — scikit-learn model trained on up to 7 days of the active mode's samples once
  ≥ 300 exist (auto-retrained hourly, or via *Train now*). Features: log in/out vs the interface median, log total
  vs rolling mean, time of day (sin/cos), campus area one-hot. The threshold is the score that only
  `ml_contamination` (default 0.2 %) of training samples exceed. ML alerts are `info` severity and are suppressed
  when the rule-based detector already explains the same interface. The UI states what data the model was
  trained on, and that a demo-trained model has only learned synthetic patterns.
* **Device unavailable** — collector reports the device unreachable → `device:<id>` alert (critical for
  routers/switches/firewalls, warning otherwise), resolved on the next successful poll.
* **Collector error** — whole-collector failure (e.g. SNMP mode with no targets, psutil failure) →
  `collector:<mode>` alert.

### Source separation

Every device, sample, alert and collector run carries `source_mode` (`demo`/`local`/`snmp`). List and
analytics endpoints default to the **active** mode so synthetic and live data are never mixed; pass
`source=all` to see everything. The UI shows the active source in the header, a persistent banner in demo
mode, and a source badge on rows.

## Data model

| Table | Key columns |
|---|---|
| `locations` | id, name (unique), subnet, vlan, description |
| `devices` | id, name, address, device_type, location_id, subnet, vlan, source_mode, enabled, status, status_reason, last_seen_at, cpu_pct, memory_pct, SNMP config (port, version, community*, username, auth/priv protocol, auth/priv key*), default_capacity_bps, meta |
| `interfaces` | id, device_id, name, alias, if_index, capacity_bps, capacity_source, oper_status, counter_bits, last counters + timestamp, latest in/out bps + utilization |
| `metric_samples` | id, timestamp, device_id, interface_id (NULL = device-level CPU/mem row), location_id, source_mode, inbound/outbound bytes, inbound/outbound bps, utilization_pct, cpu_pct, memory_pct, anomaly_score (z), ml_score |
| `alerts` | id, created/updated/resolved/acknowledged timestamps, category, severity, status, detector, title, message, device/interface/location ids, observed_value, threshold, baseline, unit, source_mode, dedup_key, occurrences |
| `collector_runs` | id, mode, trigger (schedule/manual/seed), started/finished, success, error, devices polled/failed, samples written, per-device details |
| `app_settings` | single JSON row of runtime settings |

`*` secrets: write-only through the API, never serialised. Indexes on `(interface_id, timestamp)`,
`(device_id, timestamp)`, `(source_mode, timestamp)`, `(location_id, timestamp)` and `(dedup_key, status)`.
Timestamps are stored as UTC and returned as ISO-8601 with `Z`.

Tables are created with `create_all` on startup (safe/idempotent). There is no migration tool: after changing
models in development, delete `backend/data/campus.db`. Storage access is plain SQLAlchemy; the only
SQLite-specific SQL is the time-bucket expression in `api/common.py::bucket_expr`, which is the one function to
replace when adding another backend (e.g. InfluxDB/Postgres).

## API (`/api/v1`, OpenAPI docs at `http://127.0.0.1:8000/docs`)

| Method & path | Purpose |
|---|---|
| `GET /health` | Backend + DB health, collector running, mode |
| `GET /summary` | Device counts, current in/out, utilization, alert counts |
| `GET /devices` | Inventory; filters `source, location_id, device_type, status, q` |
| `POST /devices` | Create SNMP target (validated; secrets write-only) |
| `GET/PATCH/DELETE /devices/{id}` | Device detail with interfaces / edit / delete |
| `GET /devices/{id}/metrics?range=` | Per-interface series + CPU/memory series |
| `POST /devices/{id}/test` | One-off SNMP connection test (no data stored) |
| `GET /interfaces`, `PATCH /interfaces/{id}` | Interface inventory; set/clear capacity, alias |
| `GET /metrics/traffic?range=&location_id=&device_id=&interface_id=` | Bucketed in/out series |
| `GET /metrics/traffic/by-location?range=` | Per-area series + avg/peak |
| `GET /metrics/top?range=&by=interface\|device` | Most-used interfaces/devices |
| `GET /locations?range=`, `POST`, `PATCH /{id}`, `DELETE /{id}` | Campus area summary and CRUD |
| `GET /alerts` | Filters `severity, category, status, acknowledged, range, source, device_id, location_id, limit, offset` |
| `GET /alerts/stats?range=` | Alert history per bucket/category/severity |
| `GET /alerts/{id}`, `POST /alerts/{id}/acknowledge` | Detail / acknowledge (persists) |
| `GET/PATCH /settings` | Safe runtime settings (never secrets); validation → 422 |
| `GET /collector/status`, `GET /collector/runs`, `POST /collector/poll` | Collector health, history, manual poll |
| `GET /detection/status`, `POST /detection/ml/train` | Detector configuration and ML model state |
| `POST /demo/reset`, `POST /demo/clear` | Destructive; require `{"confirm": true}` |

`range` ∈ `15m, 1h, 6h, 24h, 7d` (buckets 15 s, 1 min, 5 min, 15 min, 1 h). Invalid values → `422`.

## Frontend (`frontend/src`)

| Path | Contents |
|---|---|
| `api/client.ts` | Typed fetch wrapper, readable error messages |
| `types/` | API types mirroring the backend schemas |
| `hooks/useRefresh.tsx` | Global refresh clock (header button + auto-refresh at the poll interval), `useApi` |
| `hooks/useQueryState.ts` | Filters/time ranges stored in the URL |
| `layouts/AppLayout.tsx` | Sidebar, header (title, source badge, last updated, refresh), demo banner |
| `components/` | `ui.tsx` (cards, badges, states, dialogs), `charts.tsx`, `table.tsx` (sortable), `alerts.tsx` |
| `pages/` | Overview, Network (devices / interfaces / areas), DeviceDetail, Analytics, Alerts, Settings |

## Security notes

* Services bind to `127.0.0.1` by default; CORS allows only the local Vite origins.
* Only interface counters, status and CPU/memory are collected — no payloads, no browsing data, no per-user tracking.
* SNMP credentials live only in the local (git-ignored) SQLite file and are never returned by the API.
  Prefer SNMPv3 authPriv; SNMPv2c sends the community in clear text and is for isolated labs only.
* All SQL goes through SQLAlchemy expressions (no string-built SQL); inputs are validated by Pydantic.
* This is a lab prototype: monitor only networks you are authorised to monitor.
