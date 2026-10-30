# Smart Campus Network Monitor — Project Specification

## 1. Project Overview

Build a complete, polished, end-to-end **Smart Campus Network Monitor** for a Computer Networks project. The system monitors network devices and interfaces, tracks traffic over time, compares usage across campus locations/departments, detects congestion and unusual traffic patterns, and presents findings in a custom web dashboard.

This document is the implementation contract. Build the actual working application and integration, not just mockups, a static frontend, or a project proposal.

### Core objectives
- Provide near-real-time visibility into network usage and device/interface health.
- Compare traffic across buildings, departments, VLANs, and subnets.
- Identify sustained high utilization and traffic anomalies.
- Keep historical measurements for trend analysis.
- Present clear, actionable information in an administrator dashboard.
- Be transparent about whether displayed measurements are live, simulated, or sample data.

## 2. Non-negotiable Requirements

1. **Do not use Streamlit.** The frontend must be a custom web UI.
2. Build a cohesive, responsive, polished dashboard with a modern network-operations-center (NOC) aesthetic.
3. Implement the backend, data collection, storage, analysis, and frontend integration.
4. The app must run locally on a student laptop with documented setup steps.
5. Include a reliable demo mode with realistic seeded/simulated data, so every feature can be demonstrated even if Packet Tracer cannot expose SNMP metrics.
6. Keep live/SNMP data and simulated/demo data clearly labelled. Never represent simulated data as real campus traffic.
7. Do not fabricate successful SNMP polling. Show collector errors and unavailable metrics honestly.
8. Use maintainable modular code, type-safe interfaces where practical, validation, useful error handling, and tests.
9. Provide a README with exact commands to install, configure, run, test, and demo the project.
10. Prioritize a fully working vertical slice before adding optional complexity.

## 3. Suggested Technology Stack

Use this stack unless a genuine compatibility issue requires a clearly documented alternative.

### Frontend
- React
- TypeScript
- Vite
- Tailwind CSS
- Recharts for interactive charts
- Lucide icons (or another consistent icon library)
- React Router if multiple pages are used

### Backend
- Python 3.11+
- FastAPI
- Uvicorn
- Pydantic settings/configuration
- SQLAlchemy or SQLModel for database access
- APScheduler or a straightforward asyncio/background polling loop for periodic collection

### Storage
- SQLite as the default, zero-configuration local database.
- Keep the storage layer modular so InfluxDB can be added optionally later.
- Persist timestamped metrics, devices, interfaces, alerts, and collector status.

### Network collection and analysis
- `psutil` for local-machine interface/system metrics.
- `pysnmp` for SNMP polling of supported, reachable network devices.
- `pandas` and `numpy` for processing.
- `scikit-learn` Isolation Forest for optional ML-based anomaly detection.
- A deterministic threshold/rule-based detector must work even if the ML model is unavailable.

### Development tools
- VS Code (or any editor)
- Node.js LTS and npm
- Python virtual environment
- Cisco Packet Tracer for the simulated campus topology
- Optional: Wireshark for packet inspection

Do not require Docker for the basic run. Docker Compose may be offered as an optional convenience, not a prerequisite.

## 4. System Architecture

```text
Cisco Packet Tracer / reachable SNMP devices / local machine
                         |
                         v
                 Python data collector
               (SNMP, psutil, demo generator)
                         |
                         v
                   Metric processor
           (counter deltas, rates, utilization)
                         |
                         v
                    SQLite storage
                         |
             +-----------+-----------+
             |                       |
             v                       v
       Detection engine        FastAPI REST API
       (threshold + ML)               |
             |                        |
             +------> alerts <--------+
                                      |
                                      v
                          React + TypeScript UI
                         (custom admin dashboard)
```

### Important Packet Tracer limitation
Packet Tracer devices may not expose the SNMP counters needed by the collector. Do not assume simulated devices can be polled. Provide three explicit collection modes:
- **Demo mode:** generated time-series data, suitable for repeatable demonstrations.
- **Local mode:** real local machine network counters from `psutil`.
- **SNMP mode:** polls configured, reachable SNMP-enabled devices.

Show the active mode prominently in the UI. A user should be able to switch to demo mode without editing code. SNMP mode must clearly display device-specific failures when a target is unreachable or unsupported.

## 5. Functional Requirements

### 5.1 Overview dashboard
Show:
- Total configured devices
- Online, offline, and unknown devices
- Current inbound and outbound traffic rates
- Number of active alerts
- Average or highest link utilization when link capacity is configured
- A time-series traffic chart with inbound/outbound series
- A location/department usage comparison
- Recent alerts
- Collector health, last successful poll, and current data source/mode

Use sensible empty states and loading/error states. Include a visible “Demo data” or “Live data” indicator.

### 5.2 Campus topology and inventory
Represent at least three campus areas, for example:
- Academic Block — subnet `192.168.10.0/24`, VLAN 10
- Administration Block — subnet `192.168.20.0/24`, VLAN 20
- Student Area — subnet `192.168.30.0/24`, VLAN 30

These are demonstration defaults and should be editable/configurable.

Provide:
- Device list with name, IP address, type, campus area, subnet/VLAN, status, and last-seen time
- Search and filters by location, type, and status
- Device detail view with interfaces and recent metrics
- Interface inventory with inbound/outbound rates and optional link capacity
- Clear seeded/demo device records, distinct from real SNMP devices

Do not imply that a logical topology visualization proves real device connectivity. If including a topology diagram, label simulated/static topology accordingly.

### 5.3 Traffic monitoring
Collect/store timestamped metrics:
- Inbound bytes and outbound bytes where available
- Inbound/outbound rate in bits per second
- Interface operational status if available
- Link capacity and utilization percentage when capacity is configured
- CPU/memory where available and relevant
- Device/interface identifiers, campus location, and source mode

Use counter deltas to calculate traffic rates. For byte counters:
`rate_bps = (current_bytes - previous_bytes) * 8 / elapsed_seconds`

Handle counter resets, negative deltas, first polls, missing samples, and elapsed time of zero safely. Do not report a rate from a single cumulative counter without a previous reading. Mark missing values as unavailable, not zero.

The demo generator should create realistic, time-varying usage, including daily-pattern variation and occasional spikes, while remaining deterministic or seedable for reliable demos.

### 5.4 Congestion detection
Implement configurable threshold-based detection:
- Example default: warning above 70% utilization.
- Example default: critical above 90% utilization.
- Require capacity to calculate utilization.
- Avoid creating a new alert every polling cycle for the same persistent issue.
- Support recovery/resolution when utilization falls below the threshold.
- Make thresholds configurable.
- If capacity is unknown, show traffic rates but do not invent utilization percentages.

### 5.5 Anomaly detection
Implement:
1. A dependable rule-based detector for traffic spikes (e.g., deviation from a rolling baseline or configurable spike threshold).
2. A scikit-learn Isolation Forest option trained on available historical/demo metrics when enough data exists.

Potential features:
- Inbound/outbound rate
- Rolling mean and standard deviation
- Time of day
- Campus area/device/interface identity as context (categorical features must be encoded sensibly)
- Utilization percentage only when capacity is known

Each anomaly should have:
- Severity
- Device/interface/location
- Timestamp
- Reason or human-readable explanation
- Observed value and baseline/threshold when available
- Status (active/resolved/acknowledged)

Do not claim the ML model has learned normal usage if it has not been trained. Show the detector/model status and explain that demo data is synthetic.

### 5.6 Alerts
Support:
- Severity: info, warning, critical
- Category: congestion, traffic anomaly, device unavailable, collector error
- Timestamp, target, description, status
- Active/resolved and acknowledgement state
- Filtering by severity, type, status, and time range
- Deduplication or cooldown to prevent alert flooding
- Alert details and a clear explanation of why it fired

Email notifications are optional and must not block the core project. Do not require credentials to run locally.

### 5.7 Historical analytics
Provide:
- Time-range selection (e.g., last 15 minutes, 1 hour, 24 hours, 7 days)
- Traffic trends over time
- Compare areas/departments
- Most-used devices/interfaces
- Anomaly and alert history
- Graceful empty states when insufficient history exists

### 5.8 Settings and collection management
Provide a configuration page or panel for:
- Collection mode: demo, local, SNMP
- Poll interval (sensible bounds; default 10 seconds)
- SNMP target configuration (IP/hostname, port, version, credentials/community string, optional interface/capacity metadata)
- Campus areas, subnets, VLANs, device labels
- Congestion/anomaly thresholds
- Data retention/clear demo data actions, with confirmation before destructive actions

Never commit real SNMP credentials or secrets. Provide `.env.example`. Use SNMPv3 if supported; if using SNMPv2c for a controlled lab, document the security limitation and use read-only community credentials. Do not expose secrets in API responses or frontend logs.

## 6. API Design

Create a versioned REST API under `/api/v1`. Exact route names can vary if documented, but include equivalent functionality for:

- `GET /health` — backend health
- `GET /api/v1/summary` — overview metrics
- `GET /api/v1/devices` — inventory, filters
- `GET /api/v1/devices/{device_id}` — device detail
- `GET /api/v1/devices/{device_id}/metrics` — device/interface history
- `GET /api/v1/metrics/traffic` — traffic series filtered by time range/location/device
- `GET /api/v1/locations` — campus area summary
- `GET /api/v1/alerts` — alert list with filters
- `POST /api/v1/alerts/{alert_id}/acknowledge` — acknowledge alert
- `GET /api/v1/settings` — safe settings (never secrets)
- `PATCH /api/v1/settings` — update supported non-secret settings
- `GET /api/v1/collector/status` — mode, poll state, last success, errors
- Optional: `POST /api/v1/collector/poll` — manually trigger a poll

Define consistent response schemas and proper HTTP error codes. Add CORS configuration for the local Vite development server. Validate time ranges and query parameters.

## 7. Data Model

Use relational tables/models equivalent to:

### Device
- id
- name
- address/IP
- device_type
- location_id
- subnet
- vlan
- source_mode
- enabled
- last_seen_at
- status

### Interface
- id
- device_id
- name/index
- inbound/outbound counter values if useful
- capacity_bps (nullable)
- operational status (nullable)

### MetricSample
- id
- timestamp
- device_id
- interface_id (nullable)
- location_id
- source_mode
- inbound_bytes/outbound_bytes (nullable)
- inbound_bps/outbound_bps (nullable)
- utilization_pct (nullable)
- cpu_pct/memory_pct (nullable)
- anomaly_score (nullable)

### Alert
- id
- timestamp
- category
- severity
- title/message
- device_id/interface_id/location_id (nullable where appropriate)
- observed_value/threshold (nullable)
- status (active/resolved)
- acknowledged_at (nullable)

### Location
- id
- name
- subnet
- vlan
- description

### CollectorRun / CollectorStatus
- mode
- started/finished timestamps
- success/failure
- concise error message
- last successful poll

Create database initialization/migrations or a safe table-creation process. Add sensible indexes for timestamp and common filters.

## 8. UI/UX Specification

Build a polished custom dashboard; it should look like a finished product, not a default admin template.

### Visual direction
- Modern network operations / infrastructure monitoring product
- Dark-first theme with deep navy/charcoal surfaces, restrained cyan/blue accents, and semantic amber/red/green status colors
- Strong typography, consistent spacing, clear visual hierarchy
- Subtle borders, clean cards, restrained shadows, thoughtful hover/focus states
- Legible data visualization and compact but not cramped information density
- Responsive desktop layout; usable at tablet width
- Accessible contrast, keyboard navigation, labels, and visible focus indicators
- Avoid excessive gradients, glowing effects, gratuitous animations, and clutter

### Layout
- Persistent left sidebar with brand/title “CampusWatch” or “Smart Campus Monitor”
- Top header with page title, data-source badge, last-updated time, and refresh control
- Sidebar navigation:
  - Overview
  - Network / Devices
  - Traffic Analytics
  - Anomalies & Alerts
  - Settings
- Main dashboard with summary cards, traffic graph, location comparison, device status, and recent alerts
- Use reusable components, not one giant React component

### Interaction details
- Charts have tooltips and legends.
- Filters affect displayed data and URL/state coherently.
- Time range changes fetch/update the correct data.
- Refresh button and periodic refresh show accurate update state.
- Loading skeletons and error/retry states are present.
- Tables support sorting/filtering where appropriate.
- Empty states explain how to populate data or enable demo mode.
- Acknowledge alert interaction works and persists.
- Settings controls are functional and validated.
- Avoid dead buttons, fake links, decorative controls with no behavior, and hard-coded dashboard values presented as live readings.

## 9. Demo Mode and Seed Data

Demo mode is essential for presentation day.

Implement a generator/seed routine that:
- Creates the three example campus areas and a small set of routers/switches/APs/hosts/interfaces.
- Generates a rolling history (e.g., several hours to 24 hours) of traffic data.
- Produces normal variation, one or more high-traffic periods, and a few detectable anomalies.
- Produces some online/offline device statuses and relevant alerts.
- Lets the dashboard animate/update as new demo samples are added.
- Is reproducible using a fixed random seed or configurable seed.
- Labels all demo data conspicuously as synthetic.
- Offers a safe way to reset/reseed the demo database.

Do not seed new duplicate records on every backend startup. Use an idempotent seeding process and a clear reset command or button.

## 10. Security and Privacy

- Bind development services to localhost by default.
- Do not collect payload contents or user browsing history.
- Collect only network/device metadata needed for the project.
- Do not include personally identifying user-level tracking.
- Store secrets in environment variables or local configuration ignored by Git.
- Never return SNMP secrets to the browser.
- Validate all inputs and avoid unsafe dynamic SQL.
- Document that the prototype is for a controlled lab and requires authorization before monitoring any real network.

## 11. Project Structure

Use a clear monorepo structure similar to:

```text
smart-campus-network-monitor/
├── README.md
├── project.md
├── .gitignore
├── .env.example
├── backend/
│   ├── requirements.txt
│   ├── app/
│   │   ├── main.py
│   │   ├── api/
│   │   ├── core/
│   │   ├── db/
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── collectors/
│   │   │   ├── base.py
│   │   │   ├── demo.py
│   │   │   ├── local.py
│   │   │   └── snmp.py
│   │   ├── services/
│   │   └── detection/
│   └── tests/
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── api/
│       ├── components/
│       ├── layouts/
│       ├── pages/
│       ├── hooks/
│       ├── types/
│       └── styles/
├── scripts/
│   ├── seed_demo.py
│   └── reset_demo.py
└── docs/
    ├── architecture.md
    └── demo-guide.md
```

This is a suggested structure, not a reason to over-engineer. Keep modules cohesive and runnable.

## 12. Testing and Acceptance Criteria

The project is not complete until these are satisfied:

### Setup and operation
- [ ] A fresh local setup works using only documented commands.
- [ ] Backend health endpoint returns success.
- [ ] Frontend starts and connects to the backend.
- [ ] SQLite database is initialized automatically or with a documented command.
- [ ] Demo mode works without SNMP devices or external services.
- [ ] No secrets or machine-specific absolute paths are required.

### Functional correctness
- [ ] Dashboard values are derived from API/database data, not hard-coded UI placeholders.
- [ ] Demo samples continue updating on the configured interval.
- [ ] Inbound/outbound rates are calculated correctly from counter deltas.
- [ ] Unknown capacity does not produce invented utilization percentages.
- [ ] Congestion thresholds produce deduplicated alerts and resolve appropriately.
- [ ] Anomaly detection flags seeded anomalous samples and explains why.
- [ ] Historical charts respond to selected time range and filters.
- [ ] Device, location, alert, and collector-status pages show consistent data.
- [ ] Acknowledging an alert persists after refresh.
- [ ] SNMP failures are visible and do not crash the application.
- [ ] Source mode is clearly shown wherever metrics are presented.

### Quality
- [ ] Responsive and visually consistent UI.
- [ ] No broken navigation, dead controls, or console/API errors in normal use.
- [ ] Basic backend tests for rate calculation, detection, API endpoints, and alert handling.
- [ ] `.gitignore` excludes virtual environments, `node_modules`, databases if appropriate, `.env`, and build outputs.
- [ ] README includes troubleshooting and a presentation demo script.

## 13. Suggested Build Order

Implement and verify in this order:

1. Scaffold backend and frontend; establish a working API-to-UI connection.
2. Create SQLite models and idempotent demo seed/generator.
3. Implement summary, device, traffic, location, alert, and collector-status APIs.
4. Build the dashboard UI using real API responses.
5. Implement correct traffic-rate calculations and threshold alerts.
6. Implement rule-based anomalies, then the Isolation Forest option.
7. Add local-machine metrics collection.
8. Add configurable SNMP polling and honest failure reporting.
9. Add history filters, alert acknowledgement, settings, and polished states.
10. Test the complete flow and write setup/demo documentation.

At each step, keep the project runnable. Do not build all pages against mock arrays and postpone integration until the end.

## 14. Presentation Demo Script

The finished application should support this short demonstration:

1. Start the backend and frontend using README commands.
2. Open the dashboard and point out the current data-source indicator.
3. Show three campus areas and their devices/interfaces.
4. Show traffic charts changing as demo samples arrive.
5. Open analytics and compare usage between areas.
6. Show a seeded traffic anomaly and explain its observed value and baseline/threshold.
7. Show a congestion alert and its severity; acknowledge it and refresh to prove persistence.
8. Open historical analytics and change the time range.
9. Open settings and show collection mode and thresholds.
10. Explain how SNMP mode would poll authorized, reachable SNMP-enabled devices, and demonstrate collector status/error handling if no such device is available.

## 15. Final Deliverables

Produce:
- Complete working source code for frontend and backend.
- `project.md` (this specification) retained in the repository.
- A comprehensive `README.md`.
- `.env.example` and `.gitignore`.
- Database initialization and demo seeding/reset scripts.
- Automated tests for critical logic and API routes.
- Architecture diagram and demo guide.
- Clear setup/run commands for Windows PowerShell and, if practical, macOS/Linux.
- A concise list of implemented features, known limitations, and any unimplemented items.

## Instructions to the coding agent

Before coding, inspect the existing repository and preserve useful existing work. If it is empty, scaffold the project. Implement the application end to end rather than only returning code snippets or a plan. Run tests/build checks where possible, fix failures, and report exactly what works, the commands used, and any remaining limitations. Do not claim tests or live SNMP collection succeeded unless actually verified.
