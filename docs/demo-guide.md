# Presentation demo guide (≈10 minutes)

## Before the presentation

0. Optional but recommended: build the same campus in Cisco Packet Tracer with [packet-tracer.md](packet-tracer.md)
   and open it next to the dashboard (ping tests + MIB Browser GET show the real network side).

1. Start both services (see README → *Run*). First start seeds 24 h of synthetic history (~10 s).
2. Open <http://127.0.0.1:5173>. Check the header shows **Demo · synthetic** and the sidebar says *Collector running*.
3. Optional — fresh, reproducible dataset: *Settings → Demo data → Reset & reseed* (fixed seed 42).
4. Optional — live SNMP demo without hardware: start the SNMP simulator (README → *SNMP lab simulator*).

The demo traffic follows a daily pattern in the laptop's local time. The **Student Area common-room Wi-Fi**
(STU-AP-01, 300 Mbps) runs at 70–95 % between 10:00 and 22:00, so a congestion alert is usually active or
recent during daytime presentations. Short traffic spikes (2.5–5× normal) occur roughly once or twice an hour
across the campus; one Student Area AP drops off-line now and then; the Administration printer is permanently
unreachable; one cafeteria AP has monitoring disabled (status *unknown*).

## Script

| # | Show | Say |
|---|---|---|
| 1 | Terminal with `uvicorn` and `npm run dev` | "Python FastAPI backend with SQLite, React/TypeScript frontend. Both bound to localhost." |
| 2 | Overview header badge + pink banner | "The source is always visible. This is **synthetic demo data** — the app never presents it as real campus traffic." |
| 3 | Network & Devices → *Campus areas* tab, then *Devices* | "Four areas with their subnet/VLAN; 15 devices. Filter by area/type/status. ADMIN-PRN-01 is offline and its rates show '—', unavailable, not zero." Click a device → interfaces, capacity, CPU/memory. Point out ACAD-LAB-PC-01: capacity unknown → utilization *n/a* (never invented). |
| 4 | Overview, wait ~10 s or press **Refresh** | "The collector polls every 10 s; rates come from counter deltas: (bytes now − bytes before) × 8 ÷ seconds." The KPI values and chart move. |
| 5 | Traffic Analytics, range **24h** | "Area comparison shows the daily pattern — academic peaks at 11:00/15:00, student area in the evening. Most-used interfaces ranked by average rate." |
| 6 | Anomalies & Alerts → filter *Traffic anomaly* → open one | "The rule-based detector compares each sample with the interface's rolling baseline. Here: observed vs baseline vs threshold, z-score and ratio — it explains exactly why it fired." Show the interface chart in the drawer with the spike. Mention the Isolation Forest panel: "trained on synthetic data, so it only knows simulated patterns — it's a secondary signal." |
| 7 | Filter *Congestion* → open the STU-AP-01 alert → **Acknowledge** → browser refresh (F5) | "Utilization above 70 % for consecutive samples → one deduplicated alert (see the occurrence count), escalates to critical above 90 %, resolves itself when traffic drops. The acknowledgement is stored in the database — it survives the refresh." |
| 8 | Traffic Analytics → switch 15m / 1h / 6h / 24h / 7d | "Every chart refetches for the selected range; the URL keeps the filters." 7d shows only the history that exists. |
| 9 | Settings | "Collection mode demo / local / SNMP, poll interval, all thresholds — validated by the backend (try warning 95 % > critical 90 % → error)." |
| 10 | Settings → SNMP targets → **Add target** | "SNMP mode polls IF-MIB counters on authorised, reachable devices. Packet Tracer devices usually don't expose these counters, so here's how failures look." Add a target `192.0.2.10` (unreachable TEST-NET address, community `public`), switch mode to **SNMP**, press **Poll now**: the run shows *failed*, the device is *offline* with the timeout reason, and a *device unavailable* alert appears — nothing is faked. If the simulator is running, add `127.0.0.1:1161` community `labswitch` instead: real counters, 100/20 Mbps and an 80 % link that raises a congestion alert. |
| — | Finish: switch back to **Demo** mode | Each mode's data is stored separately, so the demo history is still there. |

Optional extra: switch to **Local machine** mode, open a video in the browser and show this laptop's real
interface traffic on the Overview chart (the Wi-Fi link reports no speed, so utilization is honestly *n/a*
until you set a capacity on the interface).

## Recovering during a demo

* Empty charts after switching mode → that mode has no history yet; switch back to Demo.
* Something looks off → *Settings → Demo data → Reset & reseed* (≈10 s) and refresh.
* "Backend unreachable" banner → the uvicorn terminal was closed; restart it, the UI recovers by itself.
