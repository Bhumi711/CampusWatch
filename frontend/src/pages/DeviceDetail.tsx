import { ArrowLeft, Pencil, PlugZap, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { AlertRow } from '../components/alerts'
import { MultiLineChart, TrafficChart } from '../components/charts'
import { Table, Th } from '../components/table'
import { Async, Badge, Button, Card, ConfirmDialog, Dialog, EmptyState, KeyValue, Meter, Segmented, Select, Skeleton, SourceBadge, StatusBadge, Toggle, cx } from '../components/ui'
import { useApi } from '../hooks/useRefresh'
import { useQueryState } from '../hooks/useQueryState'
import { RANGES, formatBps, formatPct, formatTime, timeAgo, titleCase } from '../lib/format'
import type { DeviceDetail as Detail, Interface, RangeKey, SnmpTestResult } from '../types'
import { CapacityDialog } from './Network'
import { Port } from '../components/PortPanel'

const TYPES = ['router', 'switch', 'firewall', 'access_point', 'server', 'host', 'printer', 'other']

export default function DeviceDetail() {
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const [range, setRange] = useQueryState<RangeKey>('range', '1h')
  const [iface, setIface] = useQueryState('iface', '')
  const device = useApi(() => api.device(id), [id])
  const traffic = useApi(() => api.traffic({ range, device_id: id, interface_id: iface ? Number(iface) : null, source: 'all' }), [id, range, iface])
  const metrics = useApi(() => api.deviceMetrics(id, range), [id, range])
  const alerts = useApi(() => api.alerts({ device_id: id, source: 'all', limit: 10 }), [id])
  const [editing, setEditing] = useState(false)
  const [capacity, setCapacity] = useState<Interface | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [test, setTest] = useState<SnmpTestResult | null>(null)

  if (!Number.isInteger(id)) return <EmptyState title="Invalid device id" />

  return (
    <div className="space-y-4">
      <Link to="/network" viewTransition className="icon-travel inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
        <ArrowLeft size={14} className="travel-x-back" /> Devices
      </Link>
      <Async state={device} skeleton={<Skeleton className="h-40" />}>
        {(d) => (
          <>
            <Card
              title={
                <span className="flex flex-wrap items-center gap-2 text-base">
                  {d.name} <StatusBadge status={d.status} /> <SourceBadge mode={d.source_mode} />
                </span>
              }
              subtitle={d.status_reason ?? undefined}
              actions={
                <>
                  {d.source_mode === 'snmp' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={busy}
                      onClick={async () => {
                        setBusy(true)
                        try { setTest(await api.testDevice(d.id)) } catch (e) { setTest({ reachable: false, error: (e as Error).message } as SnmpTestResult) } finally { setBusy(false) }
                      }}
                    >
                      <PlugZap size={14} /> Test SNMP
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" onClick={() => setEditing(true)}><Pencil size={14} /> Edit</Button>
                  {d.source_mode !== 'demo' && (
                    <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}><Trash2 size={14} /> Delete</Button>
                  )}
                </>
              }
            >
              <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                <KeyValue items={[
                  ['Address', <span className="num">{d.address}</span>],
                  ['Type', titleCase(d.device_type)],
                  ['Campus area', d.location_name ?? 'Unassigned'],
                  ['VLAN / subnet', [d.vlan && `VLAN ${d.vlan}`, d.subnet].filter(Boolean).join(' · ') || 'n/a'],
                ]} />
                <KeyValue items={[
                  ['Last seen', d.last_seen_at ? `${formatTime(d.last_seen_at, true)} (${timeAgo(d.last_seen_at)})` : 'never'],
                  ['Monitoring', d.enabled ? 'enabled' : 'disabled'],
                  ['Interfaces', d.interface_count],
                  ['Active alerts', d.active_alerts],
                ]} />
                <KeyValue items={[
                  ['Inbound', <span className="num">{formatBps(d.in_bps)}</span>],
                  ['Outbound', <span className="num">{formatBps(d.out_bps)}</span>],
                  ['CPU', d.cpu_pct === null ? <span className="text-faint">unavailable</span> : formatPct(d.cpu_pct)],
                  ['Memory', d.memory_pct === null ? <span className="text-faint">unavailable</span> : formatPct(d.memory_pct)],
                ]} />
              </div>
              {test && (
                <div className={cx('mt-4 rounded-lg border p-3 text-xs', test.reachable ? 'border-ok/30 bg-ok/5 text-ok' : 'border-crit/30 bg-crit/5 text-crit')}>
                  {test.reachable
                    ? `Reachable in ${test.latency_ms} ms · ${test.interfaces ?? 0} interfaces · ${test.sys_descr ?? ''}`
                    : `SNMP test failed: ${test.error}`}
                </div>
              )}
            </Card>

            <Card
              title="Traffic"
              subtitle={iface ? 'Selected interface' : 'All interfaces of this device'}
              actions={
                <>
                  <Select label="Interface" value={iface} onChange={setIface}>
                    <option value="">All interfaces</option>
                    {d.interfaces.map((i) => <option key={i.id} value={i.id}>{i.name}{i.alias ? ` (${i.alias})` : ''}</option>)}
                  </Select>
                  <Segmented label="Time range" value={range} onChange={setRange} options={RANGES} />
                </>
              }
            >
              <Async state={traffic} skeleton={<Skeleton className="h-[260px]" />} empty={(t) => (t.points.length ? null : <EmptyState title="No traffic samples in this range">{d.status === 'offline' ? 'The device is offline, so no rates can be calculated.' : 'Rates appear after two successful polls.'}</EmptyState>)}>
                {(t) => <TrafficChart points={t.points} bucket={t.bucket_seconds} />}
              </Async>
            </Card>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Card title="Interfaces" subtitle={d.interfaces.length ? 'Select a port to chart only that interface' : undefined} bodyClass="p-0">
                {d.interfaces.length > 0 && (
                  <div className="flex flex-wrap gap-0.5 border-b border-line bg-[#0b1016] px-3 py-3">
                    {d.interfaces.map((i) => (
                      <Port
                        key={i.id}
                        to={`?iface=${i.id}&range=${range}`}
                        i={{ ...i, device_name: d.name, device_status: d.status, location_id: d.location_id, location_name: d.location_name, source_mode: d.source_mode }}
                      />
                    ))}
                  </div>
                )}
                {d.interfaces.length === 0 ? (
                  <EmptyState title="No interfaces discovered yet" />
                ) : (
                  <Table>
                    <thead className="bg-surface-2/50">
                      <tr><Th>Interface</Th><Th>Oper.</Th><Th className="text-right">In</Th><Th className="text-right">Out</Th><Th className="text-right">Capacity</Th><Th>Util.</Th></tr>
                    </thead>
                    <tbody>
                      {d.interfaces.map((i) => (
                        <tr key={i.id}>
                          <td><div className="num">{i.name}</div>{i.alias && <div className="text-xs text-faint">{i.alias}</div>}</td>
                          <td>{i.stale ? <Badge>stale</Badge> : i.oper_status ? <Badge tone={i.oper_status === 'up' ? 'ok' : 'crit'}>{i.oper_status}</Badge> : 'n/a'}</td>
                          <td className="num text-right">{formatBps(i.in_bps)}</td>
                          <td className="num text-right">{formatBps(i.out_bps)}</td>
                          <td className="text-right">
                            <button type="button" onClick={() => setCapacity(i)} className="num rounded px-1 hover:bg-surface-3 hover:text-accent" title="Edit link capacity">
                              {i.capacity_bps ? formatBps(i.capacity_bps, 0) : <span className="text-faint">unknown</span>}
                            </button>
                          </td>
                          <td><Meter value={i.utilization_pct} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </Card>
              <Card title="CPU & memory" subtitle="Where the collector can read them">
                <Async state={metrics} skeleton={<Skeleton className="h-[220px]" />} empty={(m) => (m.system.some((p) => p.cpu_pct !== null || p.memory_pct !== null) ? null : <EmptyState title="CPU / memory unavailable">This device or collector does not expose CPU or memory metrics. They are shown as unavailable rather than zero.</EmptyState>)}>
                  {(m) => (
                    <MultiLineChart
                      points={m.system}
                      bucket={m.bucket_seconds}
                      height={220}
                      series={[{ key: 'cpu_pct', name: 'CPU %', color: '#3987e5' }, { key: 'memory_pct', name: 'Memory %', color: '#d95926' }]}
                      format={(v) => formatPct(v)}
                      yFormat={(v) => `${v}%`}
                    />
                  )}
                </Async>
              </Card>
            </div>

            <Card title="Alerts for this device" bodyClass="p-2">
              <Async state={alerts} empty={(a) => (a.items.length ? null : <EmptyState title="No alerts for this device" />)}>
                {(a) => <div className="divide-y divide-line">{a.items.map((x) => <AlertRow key={x.id} a={x} onOpen={() => navigate(`/alerts?alert=${x.id}&source=all`)} />)}</div>}
              </Async>
            </Card>

            <EditDevice device={d} open={editing} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); device.reload() }} />
            <CapacityDialog iface={capacity} onClose={() => setCapacity(null)} onSaved={() => { setCapacity(null); device.reload() }} />
            <ConfirmDialog
              open={confirmDelete}
              title={`Delete ${d.name}?`}
              body="This removes the device, its interfaces and all of its stored samples. Alerts are kept for history. This cannot be undone."
              confirmLabel="Delete device"
              busy={busy}
              onCancel={() => setConfirmDelete(false)}
              onConfirm={async () => {
                setBusy(true)
                try { await api.deleteDevice(d.id); navigate('/network') } finally { setBusy(false) }
              }}
            />
          </>
        )}
      </Async>
    </div>
  )
}

function EditDevice({ device, open, onClose, onSaved }: { device: Detail; open: boolean; onClose: () => void; onSaved: () => void }) {
  const locations = useApi(() => api.locations('1h'), [], false)
  const [form, setForm] = useState({ name: device.name, device_type: device.device_type, location_id: String(device.location_id ?? ''), enabled: device.enabled })
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open={open} onClose={onClose} title={`Edit ${device.name}`}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setErr(null)
          try {
            await api.updateDevice(device.id, { name: form.name.trim(), device_type: form.device_type, location_id: form.location_id ? Number(form.location_id) : null, enabled: form.enabled })
            onSaved()
          } catch (e2) {
            setErr((e2 as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      >
        <label className="block"><span className="label">Display name</span><input className="input w-full" required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label className="block">
          <span className="label">Device type</span>
          <select className="input w-full" value={form.device_type} onChange={(e) => setForm({ ...form, device_type: e.target.value })}>
            {TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="label">Campus area</span>
          <select className="input w-full" value={form.location_id} onChange={(e) => setForm({ ...form, location_id: e.target.value })}>
            <option value="">Unassigned</option>
            {(locations.data ?? []).filter((l) => l.id !== 0).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted">Monitoring enabled</span>
          <Toggle checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} label="Monitoring enabled" />
        </div>
        {err && <p role="alert" className="text-xs text-crit">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>Save</Button>
        </div>
      </form>
    </Dialog>
  )
}
