# CampusWatch — Smart Campus Network Monitor

A local network-operations dashboard for a Computer Networks project. It monitors devices and interfaces,
stores traffic history in SQLite, compares usage across campus areas, detects congestion and traffic
anomalies, and presents everything in a custom React dashboard.

* **Backend:** Python 3.11+ · FastAPI · SQLAlchemy 2 · SQLite · psutil · pysnmp 7 · pandas/numpy · scikit-learn
* **Frontend:** React 19 · TypeScript · Vite · Tailwind CSS v4 · Recharts · lucide-react · React Router
* **Three collection modes:** `demo` (seeded synthetic campus), `local` (this computer's real interface counters),
  `snmp` (authorised SNMP v2c/v3 devices). The active mode is always shown in the UI; demo data is labelled synthetic.

> Lab prototype. Only monitor networks you are authorised to monitor. It collects interface counters, status
> and CPU/memory only — no packet payloads, browsing history or user tracking.

**New to the project? Start with [docs/CampusWatch_Project_Guide.pdf](docs/CampusWatch_Project_Guide.pdf)** (how it works, how to run,
demo script, likely professor questions). Packet Tracer build guide: [docs/Packet_Tracer_Topology.pdf](docs/Packet_Tracer_Topology.pdf).
Rebuild either PDF with `tectonic docs/<name>.tex`.

The full specification is in [project.md](project.md); design details in [docs/architecture.md](docs/architecture.md);
the presentation script in [docs/demo-guide.md](docs/demo-guide.md); the matching Cisco Packet Tracer
topology (devices, cabling, IOS configs, verification) in [docs/packet-tracer.md](docs/packet-tracer.md).

---

## Requirements

| Tool | Version | Check |
|---|---|---|
| Python | 3.11 or newer (tested with 3.13) | `python --version` (Windows: `py --version`) |
| Node.js | 20.19+ or 22.12+ (LTS) | `node --version` |
| npm | comes with Node | `npm --version` |

No Docker, database server, internet services or credentials are required for demo mode.

## Install (once)

### macOS / Linux

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ../frontend
npm install
```

### Windows (PowerShell)

```powershell
cd backend
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1      # if blocked: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
pip install -r requirements.txt
cd ..\frontend
npm install
```

Optional configuration: copy `.env.example` to `.env` in the repo root (all values have defaults).

## Run

Use two terminals.

**Terminal 1 — backend** (port 8000)

```bash
# macOS / Linux
cd backend
source .venv/bin/activate
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

```powershell
# Windows PowerShell
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

On the first start the SQLite database (`backend/data/campus.db`) is created and 24 hours of synthetic demo
history are generated (about 10 seconds; look for `Demo seed: {'seeded': True, ...}`). Later starts reuse the
existing data — nothing is duplicated.

**Terminal 2 — frontend** (port 5173)

```bash
cd frontend
npm run dev
```

Open **<http://127.0.0.1:5173>**. The Vite dev server proxies `/api` and `/health` to the backend.

Quick checks: <http://127.0.0.1:8000/health> → `{"status":"ok",...}` · API docs: <http://127.0.0.1:8000/docs>

Production-style build of the UI: `npm run build` then `npm run preview` (serves `dist/` on port 4173 with the same proxy).

## Test & build checks

```bash
# backend (from backend/, venv active)
python -m pytest -q          # 23 tests: rate maths, detectors, alert dedup, API endpoints, SNMP failure handling

# frontend (from frontend/)
npm run build                # TypeScript type-check + production build
npm run lint                 # oxlint
```

## Demo data management

| Action | How |
|---|---|
| Seed (idempotent) | automatic on startup, or `backend/.venv/bin/python scripts/seed_demo.py` (Windows: `backend\.venv\Scripts\python scripts\seed_demo.py`) |
| Reset & reseed | UI: *Settings → Demo data → Reset & reseed* (confirmation). CLI with backend stopped: `python scripts/reset_demo.py` (asks to type `reset`; `--yes` to skip, `--clear-only` to just delete) |
| Clear | UI: *Settings → Demo data → Clear demo data* |
| Start completely fresh | stop the backend and delete `backend/data/campus.db*` |

Scripts are run from the repo root with the backend venv's Python. Demo data is reproducible (`DEMO_SEED=42`)
and only touches `source_mode = demo` rows; local and SNMP data are never affected.

## Using the collection modes

Switch modes in **Settings → Data collection** (takes effect immediately; no code edits).

* **Demo** — synthetic campus: 4 areas (Academic Block `192.168.10.0/24` VLAN 10, Administration Block
  `192.168.20.0/24` VLAN 20, Student Area `192.168.30.0/24` VLAN 30, Data Center `10.10.0.0/24` VLAN 100),
  15 routers/switches/APs/servers/hosts, daily traffic patterns, a congested Wi-Fi link, random spikes, an offline
  printer, a flapping AP and a disabled AP. Edit areas in *Settings → Campus areas*.
* **Local machine** — real counters of this computer's active interfaces via psutil (loopback/virtual
  interfaces skipped). Wi-Fi adapters often report no link speed, so utilization stays *n/a* until you set a
  capacity (pencil icon in *Network → Interfaces*). The device appears as *Unassigned*; assign it an area via *Edit*.
* **SNMP** — add targets in *Settings → SNMP targets* (IP/hostname, port, v3 user + SHA/AES keys or v2c
  read-only community, area, optional default capacity). *Test* checks a target without storing data. The
  collector walks IF-MIB (`ifHCInOctets/ifHCOutOctets` with 32-bit fallback, `ifHighSpeed/ifSpeed`,
  `ifOperStatus`) plus best-effort CPU/RAM from HOST-RESOURCES-MIB / Cisco CPU MIB. Unreachable or
  unsupported targets are marked *offline* with the exact error and raise *device unavailable* alerts.

  **Cisco Packet Tracer:** SNMP in Packet Tracer runs inside the simulation (its MIB Browser); simulated devices
  are not reachable from your real computer and don't provide the needed live interface counters. Use Demo mode
  for presentations, and SNMP mode with real lab equipment or the simulator below.

  **Security:** SNMPv2c sends the community in clear text — use only a read-only community on an isolated lab
  network. Prefer SNMPv3 authPriv. Credentials are stored only in the local, git-ignored database and are never
  returned by the API.

### SNMP lab simulator (optional, no hardware)

`scripts/snmpsim/labswitch.snmprec` describes a lab switch whose counters grow at fixed rates
(Gi0/1 100/20 Mbps on 1 Gbps, Gi0/2 80/10 Mbps on 100 Mbps → congestion, Gi0/3 down, lo0 skipped). Run it with
[snmpsim](https://pypi.org/project/snmpsim/) in a **separate** virtual environment:

```bash
python3 -m venv .simvenv && source .simvenv/bin/activate        # Windows: py -3 -m venv .simvenv; .\.simvenv\Scripts\Activate.ps1
pip install snmpsim pysmi cryptography
snmpsim-command-responder --data-dir=scripts/snmpsim --agent-udpv4-endpoint=127.0.0.1:1161
```

Then add an SNMP target: address `127.0.0.1`, port `1161`, version `v2c`, community `labswitch`, and switch to SNMP mode.

## Configuration (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | `sqlite:///<repo>/backend/data/campus.db` | SQLAlchemy URL |
| `COLLECTION_MODE` | `demo` | initial mode (UI changes are persisted in the DB and take precedence) |
| `POLL_INTERVAL_SECONDS` | `10` | initial poll interval (5–300) |
| `DEMO_AUTO_SEED` / `DEMO_SEED` / `DEMO_HISTORY_HOURS` | `true` / `42` / `24` | demo seeding |
| `SNMP_TIMEOUT_SECONDS` / `SNMP_RETRIES` | `2` / `1` | per-request SNMP timeout and retries |
| `CORS_ORIGINS` | local Vite origins | allowed browser origins |
| `COLLECTOR_ENABLED` | `true` | run the background poller |

Detection thresholds, cooldown, retention and the Isolation Forest are edited in *Settings → Detection thresholds*.

## Features

* **Overview** — devices online/offline/unknown, current inbound/outbound, active alerts, peak/average link
  utilization (only where capacity is known), traffic chart (15m–24h), per-area comparison, recent alerts,
  non-online devices, collector health with last poll/last success and per-device errors.
* **Network & Devices** — searchable, filterable, sortable device and interface tables; editable link
  capacity; campus area view (labelled as a logical inventory view, not discovered topology); device detail
  with per-interface traffic, CPU/memory, alerts, edit/delete and SNMP test.
* **Traffic Analytics** — 15m/1h/6h/24h/7d ranges and area filter (kept in the URL), traffic trend, area
  comparison over time, area summary (avg/peak), most-used interfaces/devices, alert & anomaly history.
* **Anomalies & Alerts** — detector status (thresholds, rule-based, Isolation Forest with *Train now*), filters
  by severity/category/status/acknowledgement/time range/source, pagination, detail drawer with explanation,
  observed/threshold/baseline and the interface's traffic, persistent acknowledgement.
* **Settings** — collection mode, poll interval, *Poll now*, recent collector runs, validated thresholds,
  SNMP target CRUD with write-only secrets, campus area CRUD, demo reset/clear with confirmation.
* **Correctness rules** — rates only from counter deltas; first poll/zero elapsed/counter reset/unreachable →
  unavailable, never zero; 32-bit wrap handled; no utilization without capacity; one deduplicated alert per
  issue with cooldown re-open and auto-resolve; demo/local/SNMP data never mixed.

## Project structure

```text
├── README.md · project.md · .env.example · .gitignore
├── backend/
│   ├── requirements.txt
│   ├── app/  (main.py, api/, core/, db/, models/, schemas/, collectors/, services/, detection/)
│   └── tests/  (test_rates.py, test_detection.py, test_api.py)
├── frontend/
│   ├── package.json · vite.config.ts · index.html
│   └── src/  (api/, components/, hooks/, layouts/, lib/, pages/, styles/, types/)
├── scripts/  (seed_demo.py, reset_demo.py, snmpsim/labswitch.snmprec)
└── docs/  (architecture.md, demo-guide.md, packet-tracer.md, CampusWatch_Project_Guide.tex/.pdf, Packet_Tracer_Topology.tex/.pdf)
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| UI shows "Backend unreachable" / "Cannot reach the backend" | Start the backend on port 8000 (Terminal 1). The UI reconnects automatically. |
| `Address already in use` | Another process uses 8000/5173. Stop it, or run `uvicorn ... --port 8010` and start the UI with `VITE_API_PROXY=http://127.0.0.1:8010 npm run dev`. |
| `Activate.ps1 cannot be loaded` (Windows) | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, or skip activation: `.\.venv\Scripts\python -m uvicorn app.main:app --port 8000`. |
| Vite says Node is too old | Install Node 22 LTS. |
| Charts empty right after switching to Local/SNMP | Rates need two polls; history builds over time. Demo mode has 24 h of history immediately. |
| Utilization shows *n/a* | Link capacity unknown — set it on the interface (pencil icon) or give the SNMP target a default capacity. |
| SNMP target offline: "No SNMP response received before timeout" | Wrong IP/port/community/credentials, ACL/firewall, or SNMP disabled. Use *Test*, and check with `snmpwalk -v2c -c <community> <ip> 1.3.6.1.2.1.2.2.1.2`. |
| SNMPv3 "Ciphering services not available" | `pip install -r requirements.txt` (needs `cryptography`). |
| Isolation Forest "Not trained" | Needs ≥ 300 traffic samples of the active mode; demo has enough, local/SNMP after a few minutes. Press *Train now*. |
| Odd data after changing models / weird state | Stop the backend, delete `backend/data/campus.db*`, start again (reseeds). |

## Known limitations

* Aggregate "campus" and per-area traffic is the sum of monitored interface rates. Traffic that crosses several
  monitored interfaces (e.g. an AP and its building switch uplink) is counted once per interface, so totals
  indicate load, not unique bytes.
* Utilization uses the busier direction of a full-duplex link; half-duplex media (Wi-Fi airtime) are approximated.
* Rule-based baselines are short-term (rolling window), not seasonal; slow daily ramps don't alert by design,
  and sudden legitimate surges (e.g. a lab session starting) can be flagged.
* The Isolation Forest is unsupervised and a secondary signal. On demo data it learns synthetic patterns only.
  The model lives in memory and is retrained on startup/hourly.
* SNMP: v2c and v3 only (no v1); default SNMP context; CPU/memory only where HOST-RESOURCES-MIB or the Cisco
  CPU MIB is exposed. Real SNMP polling was verified against the snmpsim simulator (v2c end-to-end; v3 authPriv
  credentials), not against physical campus equipment. Packet Tracer devices typically cannot be polled.
* Local mode reads psutil counters; interface speed is often unknown on Wi-Fi/virtual adapters.
* Single-process app with an in-memory scheduler; no authentication/user accounts (bind to localhost only).
* No schema migrations (tables are created automatically; delete the DB after model changes).
* Email notifications are not implemented (optional in the spec).
