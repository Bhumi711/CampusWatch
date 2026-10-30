import { Pencil, Search } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { Table, Th, useSort } from '../components/table'
import { Async, Badge, Button, Card, Dialog, EmptyState, Meter, Select, Skeleton, SourceBadge, StatusBadge, Tabs, cx } from '../components/ui'
import { useApi } from '../hooks/useRefresh'
import { useQueryState } from '../hooks/useQueryState'
import { formatBps, formatPct, timeAgo, titleCase } from '../lib/format'
import { areaColor } from '../lib/network'
import type { Device, InterfaceRow, LocationSummary } from '../types'

type Tab = 'devices' | 'interfaces' | 'areas'

export default function Network() {
  const [tab, setTab] = useQueryState<Tab>('tab', 'devices')
  const [q, setQ] = useQueryState('q', '')
  const [location, setLocation] = useQueryState('location', '')
  const [type, setType] = useQueryState('type', '')
  const [status, setStatus] = useQueryState('status', '')
  const devices = useApi(() => api.devices(), [])
  const interfaces = useApi(() => api.interfaces(), [])
  const locations = useApi(() => api.locations('1h'), [])

  const all = devices.data ?? []
  const types = [...new Set(all.map((d) => d.device_type))].sort()
  const filteredDevices = all.filter(
    (d) =>
      (!location || String(d.location_id ?? 0) === location) &&
      (!type || d.device_type === type) &&
      (!status || d.status === status) &&
      (!q || `${d.name} ${d.address} ${d.location_name ?? ''}`.toLowerCase().includes(q.toLowerCase())),
  )
  const devById = new Map(all.map((d) => [d.id, d]))
  const filteredIfaces = (interfaces.data ?? []).filter((i) => {
    const d = devById.get(i.device_id)
    return (
      (!location || String(i.location_id ?? 0) === location) &&
      (!type || d?.device_type === type) &&
      (!status || i.device_status === status) &&
      (!q || `${i.device_name} ${i.name} ${i.alias ?? ''} ${i.location_name ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    )
  })

  return (
    <div className="space-y-4">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'devices', label: 'Devices', count: devices.data?.length },
          { key: 'interfaces', label: 'Interfaces', count: interfaces.data?.length },
          { key: 'areas', label: 'Campus areas', count: locations.data?.length },
        ]}
      />

      {tab !== 'areas' && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <span className="sr-only">Search</span>
            <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" />
            <input className="input h-8 w-60 pl-8 text-xs" placeholder="Search name, IP, area…" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <Select label="Campus area" value={location} onChange={setLocation}>
            <option value="">All areas</option>
            {(locations.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
          <Select label="Device type" value={type} onChange={setType}>
            <option value="">All types</option>
            {types.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
          </Select>
          <Select label="Status" value={status} onChange={setStatus}>
            <option value="">Any status</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
            <option value="unknown">Unknown</option>
          </Select>
          {(q || location || type || status) && (
            <Button size="sm" variant="ghost" onClick={() => { setQ(''); setLocation(''); setType(''); setStatus('') }}>Clear filters</Button>
          )}
        </div>
      )}

      {tab === 'devices' && (
        <Card bodyClass="p-0">
          <Async state={devices} skeleton={<Skeleton className="m-4 h-64" />} empty={(d) => (d.length === 0 ? <NoDevices /> : null)}>
            {() => (filteredDevices.length ? <DeviceTable rows={filteredDevices} /> : <EmptyState title="No devices match these filters" />)}
          </Async>
        </Card>
      )}
      {tab === 'interfaces' && (
        <Card bodyClass="p-0">
          <Async state={interfaces} skeleton={<Skeleton className="m-4 h-64" />} empty={(d) => (d.length === 0 ? <NoDevices /> : null)}>
            {() => (filteredIfaces.length ? <InterfaceTable rows={filteredIfaces} onChanged={interfaces.reload} /> : <EmptyState title="No interfaces match these filters" />)}
          </Async>
        </Card>
      )}
      {tab === 'areas' && (
        <Async state={locations}>{(locs) => <Areas locations={locs} devices={all} />}</Async>
      )}
    </div>
  )
}

function NoDevices() {
  return (
    <EmptyState title="No devices for the active data source">
      Demo mode seeds a sample campus automatically. Local mode creates this computer on the first poll. In SNMP mode, add targets under{' '}
      <Link className="text-accent underline underline-offset-2" to="/settings">Settings, SNMP targets</Link>.
    </EmptyState>
  )
}

type DevKey = 'name' | 'device_type' | 'location_name' | 'status' | 'in_bps' | 'out_bps' | 'max_utilization_pct' | 'cpu_pct' | 'last_seen_at'

function DeviceTable({ rows }: { rows: Device[] }) {
  const { sorted, sort, toggle } = useSort<Device, DevKey>(rows, { key: 'name', dir: 'asc' }, (r, k) => r[k])
  const th = (k: DevKey, label: string, cls?: string) => <Th k={k} sort={sort} onSort={toggle} className={cls}>{label}</Th>
  return (
    <Table>
      <thead className="bg-surface-2/50">
        <tr>
          {th('name', 'Device')}
          {th('device_type', 'Type')}
          {th('location_name', 'Area / VLAN')}
          {th('status', 'Status')}
          {th('in_bps', 'Inbound', 'text-right')}
          {th('out_bps', 'Outbound', 'text-right')}
          {th('max_utilization_pct', 'Max util.')}
          {th('cpu_pct', 'CPU', 'text-right')}
          {th('last_seen_at', 'Last seen')}
          <Th>Source</Th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((d) => (
          <tr key={d.id} className="row-link">
            <td>
              <Link to={`/network/devices/${d.id}`} viewTransition className="row-name font-medium text-ink">{d.name}</Link>
              <div className="mono num text-xs text-faint">{d.address}</div>
            </td>
            <td className="text-muted">{titleCase(d.device_type)}</td>
            <td>
              <div className="text-ink">{d.location_name ?? <span className="text-faint">Unassigned</span>}</div>
              <div className="num text-xs text-faint">{[d.vlan && `VLAN ${d.vlan}`, d.subnet].filter(Boolean).join(' · ') || 'n/a'}</div>
            </td>
            <td><StatusBadge status={d.status} title={d.status_reason ?? undefined} /></td>
            <td className="num text-right">{formatBps(d.in_bps)}</td>
            <td className="num text-right">{formatBps(d.out_bps)}</td>
            <td><Meter value={d.max_utilization_pct} /></td>
            <td className="num text-right text-muted">{formatPct(d.cpu_pct, 0)}</td>
            <td className="whitespace-nowrap text-xs text-muted">{timeAgo(d.last_seen_at)}</td>
            <td><SourceBadge mode={d.source_mode} compact /></td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}

type IfKey = 'device_name' | 'name' | 'location_name' | 'oper_status' | 'in_bps' | 'out_bps' | 'capacity_bps' | 'utilization_pct'

function InterfaceTable({ rows, onChanged }: { rows: InterfaceRow[]; onChanged: () => void }) {
  const { sorted, sort, toggle } = useSort<InterfaceRow, IfKey>(rows, { key: 'device_name', dir: 'asc' }, (r, k) => r[k])
  const [editing, setEditing] = useState<InterfaceRow | null>(null)
  const th = (k: IfKey, label: string, cls?: string) => <Th k={k} sort={sort} onSort={toggle} className={cls}>{label}</Th>
  return (
    <>
      <Table>
        <thead className="bg-surface-2/50">
          <tr>
            {th('device_name', 'Device')}
            {th('name', 'Interface')}
            {th('location_name', 'Area')}
            {th('oper_status', 'Oper.')}
            {th('in_bps', 'Inbound', 'text-right')}
            {th('out_bps', 'Outbound', 'text-right')}
            {th('capacity_bps', 'Capacity', 'text-right')}
            {th('utilization_pct', 'Utilization')}
            <Th>Source</Th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((i) => (
            <tr key={i.id} className="row-link">
              <td><Link to={`/network/devices/${i.device_id}`} viewTransition className="row-name font-medium">{i.device_name}</Link></td>
              <td>
                <div className="num">{i.name}</div>
                {i.alias && <div className="text-xs text-faint">{i.alias}</div>}
              </td>
              <td className="text-muted">{i.location_name ?? 'n/a'}</td>
              <td>
                {i.stale ? <Badge title="No fresh sample, rates unavailable">stale</Badge> : i.oper_status ? <Badge tone={i.oper_status === 'up' ? 'ok' : 'crit'}>{i.oper_status}</Badge> : <span className="text-faint">n/a</span>}
              </td>
              <td className="num text-right">{formatBps(i.in_bps)}</td>
              <td className="num text-right">{formatBps(i.out_bps)}</td>
              <td className="text-right">
                <button type="button" onClick={() => setEditing(i)} className="group inline-flex items-center gap-1.5 rounded px-1 hover:bg-surface-3" title="Edit link capacity">
                  <span className={cx('num', !i.capacity_bps && 'text-faint')}>{i.capacity_bps ? formatBps(i.capacity_bps, 0) : 'unknown'}</span>
                  <Pencil size={12} className="text-faint group-hover:text-accent" />
                </button>
                {i.capacity_source && <div className="text-[10px] text-faint">{i.capacity_source}</div>}
              </td>
              <td><Meter value={i.utilization_pct} /></td>
              <td><SourceBadge mode={i.source_mode} compact /></td>
            </tr>
          ))}
        </tbody>
      </Table>
      <CapacityDialog iface={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged() }} />
    </>
  )
}

export function CapacityDialog({ iface, onClose, onSaved }: {
  iface: { id: number; name: string; capacity_bps: number | null; alias: string | null } | null
  onClose: () => void
  onSaved: () => void
}) {
  const [mbps, setMbps] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [lastId, setLastId] = useState<number | null>(null)
  if (iface && iface.id !== lastId) {
    setLastId(iface.id)
    setMbps(iface.capacity_bps ? String(iface.capacity_bps / 1e6) : '')
    setErr(null)
  }
  const save = async (value: number | null) => {
    setBusy(true)
    setErr(null)
    try {
      await api.updateInterface(iface!.id, { capacity_bps: value })
      onSaved()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={!!iface} onClose={onClose} title={`Link capacity · ${iface?.name ?? ''}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const v = Number(mbps)
          if (!mbps || !Number.isFinite(v) || v <= 0) return setErr('Enter a positive number of Mbps')
          save(v * 1e6)
        }}
        className="space-y-4"
      >
        <p className="text-xs leading-relaxed text-muted">
          Utilization is only calculated when capacity is known. A configured value overrides the speed reported by the device. Clearing it falls back to the reported speed (if any).
        </p>
        <label className="block">
          <span className="label">Capacity (Mbps)</span>
          <input className="input w-full" type="number" min="0.001" step="any" inputMode="decimal" value={mbps} onChange={(e) => setMbps(e.target.value)} autoFocus />
        </label>
        {err && <p role="alert" className="text-xs text-crit">{err}</p>}
        <div className="flex justify-between gap-2">
          <Button variant="ghost" onClick={() => save(null)} disabled={busy}>Clear configured</Button>
          <Button type="submit" loading={busy}>Save</Button>
        </div>
      </form>
    </Dialog>
  )
}

function Areas({ locations, devices }: { locations: LocationSummary[]; devices: Device[] }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-faint">
        Logical view grouped by configured campus area. It reflects inventory configuration, not discovered physical connectivity.
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {locations.map((l) => {
          const devs = devices.filter((d) => (d.location_id ?? 0) === l.id)
          return (
            <Card
              key={l.id}
              className="relative"
              title={<span className="flex items-center gap-2"><span aria-hidden="true" className="h-3.5 w-1 rounded-[1px]" style={{ background: areaColor(l.id || null) }} />{l.name}</span>}
              subtitle={[l.vlan && `VLAN ${l.vlan}`, l.subnet, l.description].filter(Boolean).join(' · ')}
              actions={<span className="num text-xs text-muted">{formatBps((l.in_bps ?? 0) + (l.out_bps ?? 0) || null)} now</span>}
            >
              {devs.length === 0 ? (
                <p className="text-xs text-faint">No devices for this source.</p>
              ) : (
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {devs.map((d) => (
                    <li key={d.id} className="row-link rounded-[6px] border border-line bg-surface-2">
                      <Link to={`/network/devices/${d.id}`} viewTransition className="flex items-center gap-2.5 px-3 py-2">
                        <span className={cx('size-2 shrink-0 rounded-full', d.status === 'online' ? 'bg-ok' : d.status === 'offline' ? 'bg-crit' : 'bg-faint')} aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <div className="row-name truncate text-sm font-medium">{d.name}</div>
                          <div className="num truncate text-xs text-faint">{titleCase(d.device_type)} · {d.address}</div>
                        </div>
                        <span className="num text-xs text-muted">{d.interface_count} if</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
