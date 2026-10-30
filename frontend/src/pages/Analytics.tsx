import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { MultiLineChart, StackedBars, TrafficChart } from '../components/charts'
import { Table, Th } from '../components/table'
import { Async, Badge, Card, EmptyState, Meter, Segmented, Select, Skeleton } from '../components/ui'
import { useApi } from '../hooks/useRefresh'
import { useQueryState } from '../hooks/useQueryState'
import { CATEGORY_LABEL, RANGES, formatBps, formatBytes } from '../lib/format'
import { areaColor } from '../lib/network'
import type { AlertCategory, RangeKey } from '../types'

// Validated categorical slots (dark surface); stacked in this order.
const CAT_COLORS: Record<AlertCategory, string> = {
  congestion: '#c98500',
  traffic_anomaly: '#9085e9',
  device_unavailable: '#e66767',
  collector_error: '#3987e5',
}
const groupColor = (key: string) => areaColor(Number(key.slice(3)) || null)

export default function Analytics() {
  const [range, setRange] = useQueryState<RangeKey>('range', '24h')
  const [location, setLocation] = useQueryState('location', '')
  const [by, setBy] = useQueryState<'interface' | 'device'>('by', 'interface')
  const locations = useApi(() => api.locations(range), [range])
  const trend = useApi(() => api.traffic({ range, location_id: location ? Number(location) : null }), [range, location])
  const grouped = useApi(() => api.trafficByLocation(range), [range])
  const top = useApi(() => api.top(range, by, 10), [range, by])
  const stats = useApi(() => api.alertStats(range), [range])
  const locName = locations.data?.find((l) => String(l.id) === location)?.name

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Historical traffic, area comparison and detector history for the active data source.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Select label="Campus area" value={location} onChange={setLocation}>
            <option value="">All areas</option>
            {(locations.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
          <Segmented label="Time range" value={range} onChange={setRange} options={RANGES} />
        </div>
      </div>

      <Card title={`Traffic trend · ${locName ?? 'all areas'}`} subtitle={trend.data ? `Bucket ${trend.data.bucket_seconds >= 3600 ? `${trend.data.bucket_seconds / 3600}h` : `${trend.data.bucket_seconds / 60 >= 1 ? `${trend.data.bucket_seconds / 60}m` : `${trend.data.bucket_seconds}s`}`} averages` : undefined}>
        <Async state={trend} skeleton={<Skeleton className="h-[280px]" />} empty={(d) => (d.points.length ? null : <NoHistory />)}>
          {(d) => <TrafficChart points={d.points} bucket={d.bucket_seconds} height={280} />}
        </Async>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3" title="Area comparison" subtitle="Combined inbound + outbound rate per campus area">
          <Async state={grouped} skeleton={<Skeleton className="h-[280px]" />} empty={(d) => (d.points.length ? null : <NoHistory />)}>
            {(d) => <MultiLineChart points={d.points} series={d.groups.map((g) => ({ key: g.key, name: g.name, color: groupColor(g.key) }))} bucket={d.bucket_seconds} />}
          </Async>
        </Card>
        <Card className="xl:col-span-2" title="Area summary" subtitle={`Over the last ${range}`} bodyClass="p-0">
          <Async state={grouped} skeleton={<Skeleton className="m-4 h-48" />} empty={(d) => (d.groups.length ? null : <NoHistory />)}>
            {(d) => {
              const max = Math.max(...d.groups.map((g) => g.avg_total_bps ?? 0), 1)
              return (
                <Table>
                  <thead className="bg-surface-2/50"><tr><Th>Area</Th><Th className="text-right">Avg in</Th><Th className="text-right">Avg out</Th><Th className="text-right">Peak</Th></tr></thead>
                  <tbody>
                    {[...d.groups].sort((a, b) => (b.avg_total_bps ?? 0) - (a.avg_total_bps ?? 0)).map((g) => (
                      <tr key={g.key}>
                        <td>
                          <div className="flex items-center gap-2">
                            <span className="size-2 rounded-full" style={{ background: groupColor(g.key) }} />
                            <span className="font-medium">{g.name}</span>
                          </div>
                          <div className="mt-1.5 h-1 rounded-full bg-surface-3"><div className="h-full rounded-full bg-accent/70" style={{ width: `${((g.avg_total_bps ?? 0) / max) * 100}%` }} /></div>
                        </td>
                        <td className="num text-right">{formatBps(g.avg_in_bps)}</td>
                        <td className="num text-right">{formatBps(g.avg_out_bps)}</td>
                        <td className="num text-right">{formatBps(g.peak_total_bps)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )
            }}
          </Async>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card
          title="Most-used"
          subtitle="Ranked by average combined rate"
          bodyClass="p-0"
          actions={<Segmented label="Group by" value={by} onChange={setBy} options={[{ key: 'interface', label: 'Interfaces' }, { key: 'device', label: 'Devices' }]} />}
        >
          <Async state={top} skeleton={<Skeleton className="m-4 h-64" />} empty={(d) => (d.length ? null : <NoHistory />)}>
            {(rows) => (
              <Table>
                <thead className="bg-surface-2/50"><tr><Th>#</Th><Th>{by === 'interface' ? 'Interface' : 'Device'}</Th><Th className="text-right">Avg in / out</Th><Th className="text-right">Peak</Th><Th>Max util.</Th><Th className="text-right">≈ Volume</Th></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.device_id}-${r.interface_id}`}>
                      <td className="num text-faint">{i + 1}</td>
                      <td>
                        <Link to={`/network/devices/${r.device_id}`} className="font-medium hover:text-accent">{r.name}</Link>
                        <div className="text-xs text-faint">{r.location_name ?? 'Unassigned'}</div>
                      </td>
                      <td className="num text-right text-xs"><div>{formatBps(r.avg_in_bps)}</div><div className="text-faint">{formatBps(r.avg_out_bps)}</div></td>
                      <td className="num text-right">{formatBps(r.peak_total_bps)}</td>
                      <td><Meter value={r.max_utilization_pct} /></td>
                      <td className="num text-right text-muted" title="Average rate × time covered, an estimate">{formatBytes(r.est_bytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Async>
        </Card>

        <Card
          title="Alert & anomaly history"
          subtitle="Alerts raised per time bucket"
          actions={stats.data && (
            <div className="flex gap-1.5">
              <Badge tone="crit">{stats.data.by_severity.critical} critical</Badge>
              <Badge tone="warn">{stats.data.by_severity.warning} warning</Badge>
              <Badge tone="info">{stats.data.by_severity.info} info</Badge>
            </div>
          )}
        >
          <Async state={stats} skeleton={<Skeleton className="h-[240px]" />} empty={(d) => (d.timeline.length ? null : <EmptyState title="No alerts in this range" />)}>
            {(d) => (
              <>
                <StackedBars
                  points={d.timeline}
                  bucket={d.bucket_seconds}
                  height={220}
                  series={(Object.keys(CAT_COLORS) as AlertCategory[]).map((k) => ({ key: k, name: CATEGORY_LABEL[k], color: CAT_COLORS[k] }))}
                />
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(Object.keys(CAT_COLORS) as AlertCategory[]).map((k) => (
                    <Link key={k} to={`/alerts?category=${k}&range=${range}`} className="rounded-lg border border-line bg-surface-2 px-3 py-2 hover:border-line-strong">
                      <div className="text-[11px] text-faint">{CATEGORY_LABEL[k]}</div>
                      <div className="num text-lg font-semibold" style={{ color: CAT_COLORS[k] }}>{d.by_category[k]}</div>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </Async>
        </Card>
      </div>
    </div>
  )
}

function NoHistory() {
  return (
    <EmptyState title="Not enough history for this range">
      Keep the collector running to build history, pick a shorter range, or use Demo mode which seeds 24 hours of synthetic data.
    </EmptyState>
  )
}
