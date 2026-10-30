import { ArrowRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { AlertRow } from '../components/alerts'
import { LocationBars, TrafficChart } from '../components/charts'
import { PanelLegend, PortPanel } from '../components/PortPanel'
import { Async, Badge, Card, EmptyState, Latch, Meter, Segmented, Skeleton, SourceBadge, StatusBadge, cx } from '../components/ui'
import { useApi } from '../hooks/useRefresh'
import { useQueryState } from '../hooks/useQueryState'
import { RANGES, formatPct, formatTime, splitBps, timeAgo } from '../lib/format'
import { areaColor } from '../lib/network'
import type { Device, RangeKey, Summary } from '../types'

export default function Overview() {
  const [range, setRange] = useQueryState<RangeKey>('range', '1h')
  const summary = useApi(api.summary, [])
  const traffic = useApi(() => api.traffic({ range }), [range])
  const locations = useApi(() => api.locations('1h'), [])
  const interfaces = useApi(() => api.interfaces(), [])
  const alerts = useApi(() => api.alerts({ limit: 5 }), [])
  const collector = useApi(api.collector, [])
  const devices = useApi(() => api.devices(), [])
  const navigate = useNavigate()

  return (
    <div className="space-y-4">
      <Instruments s={summary.data} devices={devices.data} />

      <section aria-labelledby="panel-title" className="card p-4 lg:p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="panel-title" className="text-sm font-semibold">Front panel</h2>
            <p className="mt-0.5 text-xs text-muted">Every monitored interface as a switch port, grouped by campus area. Select a port to open its device.</p>
          </div>
          <Link to="/network?tab=interfaces" viewTransition className="icon-travel inline-flex min-h-6 items-center gap-1 text-xs text-accent">
            Interface table <ArrowRight size={13} className="travel-x" />
          </Link>
        </div>
        <Async
          state={{ data: interfaces.data && locations.data ? { i: interfaces.data, l: locations.data } : undefined, error: interfaces.error ?? locations.error, reload: interfaces.reload }}
          skeleton={<Skeleton className="h-[236px]" />}
          empty={(d) => (d.i.length ? null : <EmptyState title="No interfaces for this data source">Demo mode seeds a sample campus. Local and SNMP interfaces appear after the first poll.</EmptyState>)}
        >
          {(d) => (
            <div className="space-y-3">
              <PortPanel interfaces={d.i} locations={d.l.filter((l) => l.id !== 0)} />
              <PanelLegend />
            </div>
          )}
        </Async>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card
          className="xl:col-span-2"
          title="Campus traffic"
          subtitle="Sum of monitored interface rates, computed from counter deltas"
          actions={<Segmented label="Time range" value={range} onChange={setRange} options={RANGES.slice(0, 4)} />}
        >
          <Async
            state={traffic}
            skeleton={<Skeleton className="h-[260px]" />}
            empty={(d) =>
              d.points.length === 0 ? (
                <EmptyState title="No traffic samples in this range">
                  Rates need two polls, because each one is a difference between counter readings. Check the collector, or enable Demo mode in Settings.
                </EmptyState>
              ) : null
            }
          >
            {(d) => <TrafficChart points={d.points} bucket={d.bucket_seconds} />}
          </Async>
        </Card>

        <Card title="Collector" subtitle="Where the numbers come from" actions={collector.data && <SourceBadge mode={collector.data.mode} />}>
          <Async state={collector}>
            {(c) => {
              const tone = !c.running ? 'text-crit' : c.last_run?.success === false ? 'text-warn' : 'text-ok'
              return (
                <div className="space-y-3 text-sm">
                  <p className={cx('flex items-center gap-2 font-medium', tone)}>
                    <span className={cx('size-2 rounded-full bg-current', c.running && 'animate-pulse')} aria-hidden="true" />
                    {!c.running ? 'Stopped' : c.last_run?.success === false ? 'Last poll failed' : `Polling every ${c.poll_interval_seconds}s`}
                  </p>
                  <dl className="space-y-2">
                    <Row k="Last poll" v={c.last_run ? `${timeAgo(c.last_run.started_at)} (${c.last_run.trigger})` : 'never'} />
                    <Row k="Last success" v={c.last_success_at ? formatTime(c.last_success_at, true) : 'never'} />
                    <Row k="Devices answering" v={c.last_run ? `${c.last_run.devices_polled - c.last_run.devices_failed} of ${c.last_run.devices_polled}` : 'n/a'} />
                  </dl>
                  {c.last_run?.error && <p className="rounded-[3px] bg-crit/10 px-2.5 py-2 text-xs text-crit">{c.last_run.error}</p>}
                  {!!c.last_run?.details?.length && (
                    <ul className="space-y-1 border-t border-line pt-3 text-xs">
                      {c.last_run.details.slice(0, 4).map((d, i) => (
                        <li key={i} className="truncate text-warn" title={d.error ?? d.note}>
                          {d.device ? <span className="mono text-muted">{d.device} </span> : null}
                          {d.error ?? d.note}
                        </li>
                      ))}
                    </ul>
                  )}
                  <Link to="/settings" viewTransition className="icon-travel inline-flex min-h-6 items-center gap-1 pt-1 text-xs text-accent">
                    Collection settings <ArrowRight size={13} className="travel-x" />
                  </Link>
                </div>
              )
            }}
          </Async>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card
          title="Campus areas"
          subtitle="Current inbound and outbound rate per area"
          actions={<Link to="/analytics" viewTransition className="icon-travel inline-flex min-h-6 items-center gap-1 text-xs text-accent">Compare history <ArrowRight size={13} className="travel-x" /></Link>}
        >
          <Async state={locations} empty={(d) => (d.length === 0 ? <EmptyState title="No campus areas configured" /> : null)}>
            {(locs) => (
              <>
                <LocationBars data={locs.map((l) => ({ name: l.name, in_bps: l.in_bps, out_bps: l.out_bps }))} height={Math.max(170, locs.length * 46)} />
                <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs">
                  {locs.map((l) => (
                    <li key={l.id}>
                      <Link to={`/network?location=${l.id}`} viewTransition className="group inline-flex min-h-6 items-center gap-2 text-muted hover:text-ink">
                        <span className="h-3 w-1 rounded-[1px] transition-[height] duration-200 group-hover:h-4" style={{ background: areaColor(l.id || null) }} aria-hidden="true" />
                        {l.name}
                        <span className="num text-faint">
                          {l.devices_online} up{l.devices_offline > 0 && <span className="text-crit">, {l.devices_offline} down</span>}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Async>
        </Card>

        <div className="grid grid-cols-1 gap-4">
          <Card
            title="Recent alerts"
            subtitle="Active first, then latest"
            actions={<Link to="/alerts" viewTransition className="icon-travel inline-flex min-h-6 items-center gap-1 text-xs text-accent">All alerts <ArrowRight size={13} className="travel-x" /></Link>}
            bodyClass="p-2"
          >
            <Async state={alerts} empty={(d) => (d.items.length === 0 ? <EmptyState title="No alerts">Detectors have not raised anything for this data source yet.</EmptyState> : null)}>
              {(d) => (
                <div className="divide-y divide-line">
                  {d.items.map((a) => <AlertRow key={a.id} a={a} onOpen={() => navigate(`/alerts?alert=${a.id}`, { viewTransition: true })} />)}
                </div>
              )}
            </Async>
          </Card>
          <Card title="Needs attention" subtitle="Devices that are not online" bodyClass="p-2">
            <Async state={devices}>
              {(devs) => {
                const bad = devs.filter((d) => d.status !== 'online')
                return bad.length === 0 ? (
                  <EmptyState title={devs.length ? 'All devices online' : 'No devices for this source'} />
                ) : (
                  <ul className="divide-y divide-line">
                    {bad.map((d) => (
                      <li key={d.id} className="row-link">
                        <Link to={`/network/devices/${d.id}`} viewTransition className="flex items-center justify-between gap-3 rounded-[6px] px-3 py-2">
                          <div className="min-w-0">
                            <div className="row-name truncate text-sm font-medium">{d.name}</div>
                            <div className="truncate text-xs text-faint">{d.status_reason ?? d.address} · last seen {timeAgo(d.last_seen_at)}</div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {d.location_name && <Badge className="hidden sm:inline-flex">{d.location_name}</Badge>}
                            <StatusBadge status={d.status} />
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )
              }}
            </Async>
          </Card>
        </div>
      </div>
    </div>
  )
}

/* ---------- instrument strip ---------- */

function Instruments({ s, devices }: { s: Summary | undefined; devices: Device[] | undefined }) {
  const [inV, inU] = splitBps(s?.traffic.in_bps)
  const [outV, outU] = splitBps(s?.traffic.out_bps)
  const top = s?.utilization.max_interface
  const order = { offline: 0, unknown: 1, online: 2 } as const
  const ticks = [...(devices ?? [])].sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name))

  return (
    <section aria-label="Network status now" className="card grid grid-cols-1 divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-[1.6fr_1fr_1fr_1.2fr]">
      <Gauge label="Throughput now" className="sm:col-span-2 xl:col-span-1">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
          <Reading arrow="↓" tone="text-inbound" name="in" value={inV} unit={inU} loading={!s} />
          <Reading arrow="↑" tone="text-outbound" name="out" value={outV} unit={outU} loading={!s} />
        </div>
        <Sub>{s ? `${s.traffic.interfaces_reporting} of ${s.traffic.interfaces_total} interfaces reporting${s.traffic.as_of ? `, sampled ${formatTime(s.traffic.as_of)}` : ''}` : ' '}</Sub>
      </Gauge>

      <Gauge label="Devices up">
        <Big loading={!s}>
          {s && <><Latch>{s.devices.online}</Latch><span className="text-faint"> / {s.devices.total}</span></>}
        </Big>
        <div className="mt-2.5 flex min-h-3.5 flex-wrap gap-[3px]" aria-hidden="true">
          {ticks.map((d) => (
            <span key={d.id} title={`${d.name}: ${d.status}`} className={cx('h-3.5 w-1.5 rounded-[1px]', d.status === 'online' ? 'bg-ok/80' : d.status === 'offline' ? 'bg-crit' : 'bg-line-strong')} />
          ))}
        </div>
        <Sub>{s ? `${s.devices.offline} offline, ${s.devices.unknown} unknown` : ' '}</Sub>
      </Gauge>

      <Gauge label="Active alerts">
        <Big loading={!s} className={s?.alerts.critical ? 'text-crit' : s?.alerts.active ? 'text-warn' : 'text-ink'}>
          {s && <Latch>{s.alerts.active}</Latch>}
        </Big>
        <Sub>
          {s ? (
            <Link to="/alerts?status=active" viewTransition className="icon-travel inline-flex min-h-6 items-center gap-1 hover:text-ink">
              {s.alerts.critical} critical, {s.alerts.unacknowledged} unacknowledged <ArrowRight size={12} className="travel-x" />
            </Link>
          ) : ' '}
        </Sub>
      </Gauge>

      <Gauge label="Busiest link">
        <Big loading={!s}>
          {s && (s.utilization.max_pct === null ? <span className="text-faint">n/a</span> : <Latch>{formatPct(s.utilization.max_pct)}</Latch>)}
        </Big>
        <div className="mt-2.5 h-[18px]">{s && <Meter value={s.utilization.max_pct} bare />}</div>
        <Sub tall>
          {top ? (
            <Link to={`/network/devices/${top.device_id}`} viewTransition className="icon-travel inline-flex min-h-6 items-center gap-1 hover:text-ink">
              <span className="mono">{top.device_name} {top.name}</span>, average {formatPct(s?.utilization.average_pct ?? null)} <ArrowRight size={12} className="travel-x" />
            </Link>
          ) : s ? (s.utilization.links_with_capacity ? 'no fresh samples' : 'no link capacity configured') : ' '}
        </Sub>
      </Gauge>
    </section>
  )
}

function Gauge({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex min-w-0 flex-col justify-between gap-1 px-5 py-4', className)}>
      <h2 className="silk mb-2 text-faint">{label}</h2>
      {children}
    </div>
  )
}

function Big({ children, loading, className }: { children: ReactNode; loading?: boolean; className?: string }) {
  return <div className={cx('numeral text-[clamp(2.25rem,1.6rem+1.6vw,3rem)]', className)}>{loading ? <Skeleton className="h-[0.95em] w-24" /> : children}</div>
}

function Reading({ arrow, tone, name, value, unit, loading }: { arrow: string; tone: string; name: string; value: string; unit: string; loading?: boolean }) {
  if (loading) return <div className="numeral text-[clamp(3rem,2rem+2.6vw,4.5rem)]"><Skeleton className="h-[0.95em] w-44" /></div>
  return (
    <div className="flex items-end gap-2" aria-label={`${name}bound ${value} ${unit}`}>
      <span className={cx('numeral pb-1 text-2xl', tone)} aria-hidden="true">{arrow}</span>
      <span className="numeral text-[clamp(3rem,2rem+2.6vw,4.5rem)]"><Latch>{value}</Latch></span>
      <span className="pb-1.5 text-sm font-medium text-muted">{unit}</span>
    </div>
  )
}

function Sub({ children, tall }: { children: ReactNode; tall?: boolean }) {
  return <div className={cx('mt-2 text-xs text-muted', tall ? 'min-h-12 sm:min-h-6' : 'min-h-6')}>{children}</div>
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{k}</dt>
      <dd className="num text-right text-ink">{v}</dd>
    </div>
  )
}
