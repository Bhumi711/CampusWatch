import { useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { formatBps, formatPct } from '../lib/format'
import { areaColor, blinkPeriod, linkLed, useThresholds, type LinkLed } from '../lib/network'
import type { InterfaceRow, Location } from '../types'
import { Latch, cx } from './ui'

const LED_TEXT: Record<LinkLed, string> = {
  ok: 'link up',
  warn: 'above warning utilization',
  crit: 'above critical utilization',
  alarm: 'device unreachable',
  off: 'no fresh data',
}

/** One interface as a switch port: link LED (state) + activity LED (blinks with measured traffic). */
function describe(i: InterfaceRow, led: LinkLed) {
  const util = i.utilization_pct === null ? 'utilization n/a' : `${formatPct(i.utilization_pct)} utilization`
  return { util, label: `${i.device_name} ${i.name}: ${LED_TEXT[led]}, ${formatBps(i.in_bps)} in, ${formatBps(i.out_bps)} out, ${util}` }
}

export function Port({ i, onActive, to, prefix = '' }: { i: InterfaceRow; onActive?: (i: InterfaceRow) => void; to?: string; prefix?: string }) {
  const t = useThresholds()
  const led = linkLed(i, t)
  const total = i.in_bps === null && i.out_bps === null ? null : (i.in_bps ?? 0) + (i.out_bps ?? 0)
  const period = led === 'off' || led === 'alarm' ? null : blinkPeriod(total)
  const { label } = describe(i, led)
  return (
    <Link
      to={to ?? `/network/devices/${i.device_id}`}
      viewTransition={!to}
      onPointerEnter={() => onActive?.(i)}
      onFocus={() => onActive?.(i)}
      className="port relative w-[82px]"
      data-link={led}
      data-act={period ? 'on' : 'off'}
      style={period ? ({ '--period': `${period}s`, '--phase': `-${(i.id * 0.37) % period}s` } as CSSProperties) : undefined}
    >
      <span className="port-jack" aria-hidden="true">
        <span className="led led-link" />
        <span className="led led-act" />
      </span>
      <span className="mono w-full truncate text-center text-[10.5px] leading-tight text-muted">
        {prefix && <span className="sr-only">{prefix}</span>}
        {i.device_name.slice(prefix.length)}
        <span className="block truncate text-faint"> {i.name}</span>
      </span>
      <span className="sr-only">{label.slice(label.indexOf(':'))}</span>
    </Link>
  )
}

/** "ACAD-" when every device in a module starts with it: the module header already says where they are. */
function sharedPrefix(ports: InterfaceRow[]) {
  const first = ports[0]?.device_name.split('-')[0]
  return first && ports.every((p) => p.device_name.startsWith(`${first}-`) && p.device_name.length > first.length + 1) ? `${first}-` : ''
}

/** The campus front panel: one module per area, colour-coded like VLAN patch cables. */
export function PortPanel({ interfaces, locations }: { interfaces: InterfaceRow[]; locations: Location[] }) {
  const t = useThresholds()
  const [activeId, setActiveId] = useState<number | null>(null)
  const busiest = [...interfaces].sort((a, b) => (b.utilization_pct ?? -1) - (a.utilization_pct ?? -1))[0]
  const active = interfaces.find((i) => i.id === activeId) ?? busiest
  const groups = [...locations, { id: 0, name: 'Unassigned', subnet: null, vlan: null, description: null }]
    .map((l) => ({ loc: l, ports: interfaces.filter((i) => (i.location_id ?? 0) === l.id) }))
    .filter((g) => g.ports.length > 0)

  return (
    <div className="space-y-3">
    <div className="flex flex-wrap gap-3" onPointerLeave={() => setActiveId(null)}>
      {groups.map(({ loc, ports }) => (
        <section
          key={loc.id}
          aria-label={`${loc.name} ports`}
          className="relative min-w-0 overflow-visible rounded-[6px] border border-line bg-[#0b1016]"
          style={{ flex: `${Math.max(ports.length, 2)} 1 ${Math.min(ports.length, 4) * 72 + 28}px` }}
        >
          <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[3px] rounded-t-[6px]" style={{ background: areaColor(loc.id || null) }} />
          <header className="flex items-baseline justify-between gap-3 px-3.5 pt-3 pb-1">
            <h3 className="silk truncate text-ink">{loc.name}</h3>
            <span className="mono shrink-0 text-[11px] text-faint">
              {loc.vlan ? `VLAN ${loc.vlan}` : ''}{loc.vlan && loc.subnet ? ' · ' : ''}{loc.subnet ?? ''}
            </span>
          </header>
          <div className="flex flex-wrap gap-0.5 px-2 pb-2.5">
            {ports.map((i) => <Port key={i.id} i={i} prefix={sharedPrefix(ports)} onActive={(x) => setActiveId(x.id)} />)}
          </div>
        </section>
      ))}
    </div>
    {active && <Readout i={active} led={linkLed(active, t)} pinned={activeId === null} />}
    </div>
  )
}

/** The panel's LCD: what the pointed or focused port is doing (the busiest link otherwise). */
function Readout({ i, led, pinned }: { i: InterfaceRow; led: LinkLed; pinned: boolean }) {
  const { util } = describe(i, led)
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-1 rounded-[3px] border border-line bg-[#070a0e] px-3 py-2 text-sm" aria-hidden="true">
      <span className="silk text-faint">{pinned ? 'Busiest port' : 'Port'}</span>
      <Latch className="font-semibold text-ink">{`${i.device_name} ${i.name}`}</Latch>
      <span className="num mono text-muted">
        <span className="text-inbound">↓</span> in {formatBps(i.in_bps)}
        <span className="mx-2 text-line-strong">/</span>
        <span className="text-outbound">↑</span> out {formatBps(i.out_bps)}
      </span>
      <span className="num text-muted">{util}</span>
      <span className={cx('ml-auto text-xs', led === 'ok' ? 'text-ok' : led === 'warn' ? 'text-warn' : led === 'off' ? 'text-faint' : 'text-crit')}>{LED_TEXT[led]}</span>
    </div>
  )
}

/** Explains the LEDs in words, so colour never carries meaning alone. */
export function PanelLegend() {
  const t = useThresholds()
  const item = (cls: string, text: string, blink = false) => (
    <span className="inline-flex items-center gap-1.5">
      <span className={cx('size-2 rounded-full', cls, blink && 'animate-pulse')} aria-hidden="true" />
      {text}
    </span>
  )
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-faint">
      <span className="text-muted">Left LED, link:</span>
      {item('bg-ok', 'up')}
      {item('bg-warn', `≥ ${t.warn}% utilization`)}
      {item('bg-crit', `≥ ${t.crit}% or device unreachable`)}
      {item('bg-[#222b36] ring-1 ring-line-strong', 'no fresh data')}
      <span className="text-muted sm:ml-2">Right LED, activity:</span>
      {item('bg-warn', 'blinks faster with more traffic', true)}
    </p>
  )
}
