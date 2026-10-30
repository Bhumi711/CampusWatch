# CampusWatch UI: design system

## Brief

- **Subject:** CampusWatch, a local network monitor for a campus lab (4 areas, ~15 devices, ~17 interfaces).
- **Audience:** a network administrator and a project jury watching a live demo.
- **Job:** orient in 3 seconds (is the network healthy, where is the load, what needs attention), then drill down.
- **Constraints (project.md):** dark NOC aesthetic, deep navy/charcoal, restrained cyan, semantic green/amber/red;
  no excessive gradients, glow or gratuitous animation; demo data always labelled synthetic; values derived from the API.
- **Scale of theatre:** a working tool. No loader, no WebGL, no smooth scroll. Craft lives in type, layout,
  feedback and one signature moment.

## Concepts

| | Idea | Anchor | Signature | O / F / Fe / P |
|---|---|---|---|---|
| **A. Front panel** (material) | Every monitored interface is a switch port with a link LED and an activity LED; campus areas are patch-panel modules colour-coded like VLAN patch cables | real switches report link and traffic through port LEDs; labs colour-code patch cables per VLAN | the live front panel: activity LEDs blink at a rate derived from the measured bps, link LEDs turn amber/red at the congestion thresholds | 4 / 5 / 4 / 2 |
| B. Two readings (process) | Every number is the difference between two counter samples; the UI shows the sample clock and values latch when a poll lands | rates exist only between two readings 10 s apart | a sweep line runs to the next sample, then numbers latch | 3 / 5 / 5 / 3 |
| C. Campus day (place/time) | A 24-hour dial of campus load by hour per area | lectures by day, hostels by night | the dial's hand sweeping today's load | 4 / 4 / 3 / 3 |

**Pick A**: the most specific to network monitoring and it turns live data into the idle motion.
Stolen from B: the header sample sweep and the number latch. Stolen from A for the 404: an empty port, "no carrier".

## Concept card

```
Idea:        The dashboard is the campus switch's front panel: one port per interface, LEDs tell you link and traffic.
Metaphor:    rack-mounted network gear (anodised panels, silkscreen labels, port LEDs, colour-coded patch cables)
Signature:   Overview "front panel": area modules with ports; activity LEDs blink at the measured rate (CSS keyframes,
             period from log10 bps), link LED colour = utilization vs the configured thresholds. Ports link to devices.
Emotion:     "standing in front of a live rack": calm, precise, alive where traffic is.
Motion verb: latch: state changes snap in short and crisp (120 to 260 ms, expo-out), no bounce, nothing drifts.
Screenshot:  the front panel under the condensed throughput numerals.
```

## System

**Palette** (named after rack hardware)

| Role | Hex | Use |
|---|---|---|
| ground (rack) | `#090c11` | page |
| panel | `#0f141b` / `#141b24` / `#1b2430` | surfaces, raised, hover |
| line | `#212b38` / strong `#2e3a4a` | hairlines, port bezels |
| ink (silkscreen) | `#e6ecf3` | text |
| muted | `#97a3b4` | secondary text (AA on panel) |
| faint | `#7d8a9c` | small meta (AA on panel) |
| signal (accent) | `#38d0e6` | inbound, focus ring, current nav LED |
| outbound | `#a99bff` | outbound series only |
| LEDs | ok `#3ddc84`, warn `#f5b93d`, crit `#ff6363`, info `#6aa8ff` | status only |
| synthetic | `#f0abfc` | demo data marker only |
| VLAN cables | blue `#5aa9ff`, sand `#d9c48a`, magenta `#e27acf`, silver `#afbaca`, teal `#4fd1c5`, violet `#9c8cff` | one per campus area, everywhere that area appears |

**Type**: Archivo (variable, width 62 to 125) carries everything: width 100 for UI and text, width 75 weight 600 for
instrument numerals and panel silkscreen. JetBrains Mono only for machine values (IPs, subnets, interface names,
times). Numbers tabular. Body 15 to 16 px, tables 14 px, meta 12 to 13 px.

**Grid & rhythm**: 12-column content grid, 16 px gutter, 24 px page margin (16 on phones). Rhythm: instrument strip
(tight), front panel (airy), charts (normal).

**Shape**: 6 px panels and inputs, 3 px chips and ports, circles only for LEDs.

**Motion language**: one ease `cubic-bezier(0.16, 1, 0.3, 1)`. Hover 160 to 220 ms, latch 260 ms, page swap 140 ms out /
260 ms in (View Transitions API). Treatments, one per role:
- nav: LED marker lights and the label steps 3 px right; current page LED stays lit;
- primary buttons: fill floods from the left, label inverts;
- secondary buttons: icon travels (refresh turns, arrows nudge 3 px);
- device links / table rows / ports: a 2 px signal bar rises at the row edge, the name steps right; ports lift 2 px;
- card links: arrow travels 4 px.

**Idle**: activity LEDs (real data) and the header sample sweep (real time to next poll). Both stop under
reduced motion (LEDs steady, brightness kept).

## Composition (Overview)

```
header   Overview [Demo · synthetic]        ─────── sample sweep ───────   updated · auto · refresh
strip    THROUGHPUT ↓ 469 Mbps ↑ 189 Mbps │ DEVICES 13/15 ▮▮▮▮▯ │ ALERTS 1 │ BUSIEST LINK 38% ▬▬──
panel    [Academic · VLAN 10 ▣▣▣▣▣] [Administration · VLAN 20 ▣▣▣] [Student · VLAN 30 ▣▣▣] [Data center ▣▣▣▣]
grid     traffic chart (8)                      │ collector (4)
grid     campus areas (6)                       │ recent alerts + needs attention (6)
```

## Genericness test

A generic model lands on five equal KPI cards and a card grid (the previous version). Changed: KPI cards became one
instrument strip with condensed numerals; the front panel is the primary visual; area cable colours run through
charts, chips and panel modules; mono is reserved for machine values.

## Decisions

- Private localhost tool: `robots.txt` disallows everything, no sitemap/OG/JSON-LD (nothing public to index or share).
- No GSAP/Lenis: motion is CSS + the View Transitions API; LED blinking is compositor-driven CSS animation.
