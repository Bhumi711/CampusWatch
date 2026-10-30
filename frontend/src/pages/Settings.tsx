import { Cpu, FlaskConical, Laptop, Plus, PlugZap, RadioTower, Save, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { Table, Th } from '../components/table'
import { Async, Badge, Button, Card, ConfirmDialog, Dialog, EmptyState, Skeleton, StatusBadge, Toggle, cx } from '../components/ui'
import { useApi, useRefresh } from '../hooks/useRefresh'
import { formatTime, timeAgo, titleCase } from '../lib/format'
import type { Device, Location, Mode, Settings, SnmpTestResult } from '../types'

const MODES: Array<{ key: Mode; title: string; icon: ReactNode; body: string }> = [
  { key: 'demo', title: 'Demo', icon: <FlaskConical size={18} />, body: 'Seeded, deterministic synthetic campus traffic. Works offline; clearly labelled as not real.' },
  { key: 'local', title: 'Local machine', icon: <Laptop size={18} />, body: 'Real counters from this computer’s network interfaces via psutil.' },
  { key: 'snmp', title: 'SNMP', icon: <RadioTower size={18} />, body: 'Polls the authorised, reachable SNMP targets configured below (IF-MIB counters).' },
]

export default function SettingsPage() {
  const settings = useApi(api.settings, [], false)
  return (
    <div className="space-y-4">
      {/* everything renders together, so nothing below jumps when settings arrive */}
      <Async state={settings} skeleton={<Skeleton className="h-[70vh]" />}>
        {(s) => (
          <>
            <CollectionCard s={s} onSaved={settings.reload} />
            <ThresholdsCard s={s} onSaved={settings.reload} />
            <SnmpTargets />
            <Areas />
            <DemoData />
          </>
        )}
      </Async>
    </div>
  )
}

function useSave() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const run = async (fn: () => Promise<unknown>, okText = 'Saved') => {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
      setMsg({ ok: true, text: okText })
      return true
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, msg, run, setMsg }
}

function Msg({ m }: { m: { ok: boolean; text: string } | null }) {
  if (!m) return null
  return <p role={m.ok ? 'status' : 'alert'} className={cx('text-xs', m.ok ? 'text-ok' : 'text-crit')}>{m.text}</p>
}

/* ---------- collection ---------- */
function CollectionCard({ s, onSaved }: { s: Settings; onSaved: () => void }) {
  const { refresh } = useRefresh()
  const save = useSave()
  const poll = useSave()
  const [interval, setIntervalValue] = useState(String(s.poll_interval_seconds))
  const runs = useApi(() => api.collectorRuns(8), [])

  const setMode = (mode: Mode) =>
    save.run(async () => {
      await api.updateSettings({ collection_mode: mode })
      onSaved()
      setTimeout(refresh, 1500) // the backend polls immediately after a mode change
    }, `Switched to ${mode} mode`)

  return (
    <Card title="Data collection" subtitle="Which collector feeds the dashboard. Data from different modes is stored separately and never mixed.">
      <div role="radiogroup" aria-label="Collection mode" className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            role="radio"
            aria-checked={s.collection_mode === m.key}
            disabled={save.busy}
            onClick={() => s.collection_mode !== m.key && setMode(m.key)}
            className={cx(
              'rounded-xl border p-4 text-left transition-colors',
              s.collection_mode === m.key ? 'border-accent/60 bg-accent/[0.06] ring-1 ring-accent/30' : 'border-line bg-surface-2 hover:border-line-strong',
            )}
          >
            <div className="flex items-center justify-between">
              <span className={cx('flex items-center gap-2 text-sm font-semibold', s.collection_mode === m.key ? 'text-accent' : 'text-ink')}>{m.icon}{m.title}</span>
              {s.collection_mode === m.key && <Badge tone="accent">active</Badge>}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted">{m.body}</p>
          </button>
        ))}
      </div>

      <form
        className="mt-5 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          save.run(async () => { await api.updateSettings({ poll_interval_seconds: Number(interval) }); onSaved() })
        }}
      >
        <label>
          <span className="label">Poll interval (5 to 300 s)</span>
          <input className="input w-32" type="number" min={5} max={300} required value={interval} onChange={(e) => setIntervalValue(e.target.value)} />
        </label>
        <Button type="submit" variant="secondary" loading={save.busy}><Save size={14} /> Save interval</Button>
        <Button variant="secondary" loading={poll.busy} onClick={() => poll.run(async () => { const r = await api.pollNow(); runs.reload(); refresh(); if (!r.success) throw new Error(r.error ?? 'Poll failed') }, 'Poll completed')}>
          <Cpu size={14} /> Poll now
        </Button>
        <Msg m={save.msg ?? poll.msg} />
      </form>

      <div className="mt-5">
        <div className="mb-2 text-xs font-medium text-muted">Recent collector runs</div>
        <Async state={runs} skeleton={<Skeleton className="h-24" />} empty={(r) => (r.length ? null : <p className="text-xs text-faint">No runs yet.</p>)}>
          {(rows) => (
            <div className="rounded-lg border border-line">
              <Table>
                <thead className="bg-surface-2/50"><tr><Th>Started</Th><Th>Mode</Th><Th>Trigger</Th><Th>Result</Th><Th className="text-right">Devices</Th><Th className="text-right">Samples</Th><Th>Errors</Th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="text-xs">
                      <td className="num whitespace-nowrap text-muted">{formatTime(r.started_at, true)}</td>
                      <td>{r.mode}</td>
                      <td className="text-muted">{r.trigger}</td>
                      <td>{r.success ? <Badge tone={r.devices_failed ? 'warn' : 'ok'}>{r.devices_failed ? 'partial' : 'ok'}</Badge> : <Badge tone="crit">failed</Badge>}</td>
                      <td className="num text-right">{r.devices_polled - r.devices_failed}/{r.devices_polled}</td>
                      <td className="num text-right">{r.samples_written}</td>
                      <td className="max-w-sm truncate text-crit" title={[r.error, ...r.details.map((d) => `${d.device ?? ''}: ${d.error ?? d.note ?? ''}`)].filter(Boolean).join('\n')}>
                        {r.error ?? r.details.map((d) => d.error ? `${d.device}: ${d.error}` : d.note).filter(Boolean).join('; ') ?? ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Async>
      </div>
    </Card>
  )
}

/* ---------- thresholds ---------- */
type NumField = { key: keyof Settings; label: string; min: number; max: number; step: number; hint?: string; scale?: number }
const FIELDS: Array<{ group: string; fields: NumField[] }> = [
  {
    group: 'Congestion',
    fields: [
      { key: 'congestion_warning_pct', label: 'Warning utilization (%)', min: 1, max: 99, step: 1 },
      { key: 'congestion_critical_pct', label: 'Critical utilization (%)', min: 2, max: 100, step: 1 },
      { key: 'congestion_consecutive_samples', label: 'Consecutive samples', min: 1, max: 20, step: 1, hint: 'Sustained-high requirement before alerting' },
    ],
  },
  {
    group: 'Traffic anomalies',
    fields: [
      { key: 'anomaly_zscore_threshold', label: 'Z-score threshold (σ)', min: 1.5, max: 10, step: 0.1 },
      { key: 'anomaly_min_ratio', label: 'Min ratio to baseline (×)', min: 1, max: 20, step: 0.1 },
      { key: 'anomaly_window_samples', label: 'Baseline window (samples)', min: 10, max: 500, step: 1 },
      { key: 'anomaly_min_bps', label: 'Ignore links below (Mbps)', min: 0, max: 100000, step: 0.1, scale: 1e6 },
      { key: 'ml_contamination', label: 'ML: unusual share (%)', min: 0.05, max: 10, step: 0.05, scale: 0.01, hint: 'Isolation Forest flags the rarest share of scores' },
    ],
  },
  {
    group: 'Alerts & retention',
    fields: [
      { key: 'alert_cooldown_seconds', label: 'Re-open cooldown (s)', min: 0, max: 86400, step: 1, hint: 'A recurring issue within this window re-opens the same alert' },
      { key: 'retention_days', label: 'Keep history (days)', min: 1, max: 90, step: 1 },
    ],
  },
]

function ThresholdsCard({ s, onSaved }: { s: Settings; onSaved: () => void }) {
  const init = () => Object.fromEntries(FIELDS.flatMap((g) => g.fields).map((f) => [f.key, String(+((s[f.key] as number) / (f.scale ?? 1)).toFixed(4))]))
  const [vals, setVals] = useState<Record<string, string>>(init)
  const [ml, setMl] = useState(s.ml_enabled)
  const save = useSave()
  return (
    <Card title="Detection thresholds" subtitle="Applied from the next poll. Validated by the backend.">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const body: Record<string, number | boolean> = { ml_enabled: ml }
          for (const f of FIELDS.flatMap((g) => g.fields)) body[f.key] = Number(vals[f.key]) * (f.scale ?? 1)
          save.run(async () => { await api.updateSettings(body as Partial<Settings>); onSaved() })
        }}
      >
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {FIELDS.map((g) => (
            <fieldset key={g.group} className="space-y-3">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">{g.group}</legend>
              {g.fields.map((f) => (
                <label key={f.key} className="block">
                  <span className="label">{f.label}</span>
                  <input className="input w-full" type="number" required min={f.min} max={f.max} step={f.step} value={vals[f.key]} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />
                  {f.hint && <span className="mt-1 block text-[11px] text-faint">{f.hint}</span>}
                </label>
              ))}
              {g.group === 'Traffic anomalies' && (
                <div className="flex items-center justify-between pt-1">
                  <span className="text-sm text-muted">Isolation Forest enabled</span>
                  <Toggle checked={ml} onChange={setMl} label="Isolation Forest enabled" />
                </div>
              )}
            </fieldset>
          ))}
        </div>
        <div className="mt-5 flex items-center gap-3">
          <Button type="submit" loading={save.busy}><Save size={14} /> Save thresholds</Button>
          <Msg m={save.msg} />
        </div>
      </form>
    </Card>
  )
}

/* ---------- SNMP targets ---------- */
function SnmpTargets() {
  const devices = useApi(() => api.devices({ source: 'snmp' }), [])
  const [editing, setEditing] = useState<Device | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Device | null>(null)
  const [tests, setTests] = useState<Record<number, SnmpTestResult | 'running'>>({})
  const del = useSave()

  const test = async (d: Device) => {
    setTests((t) => ({ ...t, [d.id]: 'running' }))
    try {
      const r = await api.testDevice(d.id)
      setTests((t) => ({ ...t, [d.id]: r }))
    } catch (e) {
      setTests((t) => ({ ...t, [d.id]: { reachable: false, error: (e as Error).message } as SnmpTestResult }))
    }
  }

  return (
    <Card
      title="SNMP targets"
      subtitle="Only poll devices you are authorised to monitor. Credentials are write-only and never returned by the API."
      actions={<Button size="sm" onClick={() => setEditing('new')}><Plus size={14} /> Add target</Button>}
      bodyClass="p-0"
    >
      <Async state={devices} skeleton={<Skeleton className="m-4 h-24" />} empty={(d) => (d.length ? null : (
        <EmptyState title="No SNMP targets yet" icon={<RadioTower size={26} />}>
          Add a router or switch with SNMPv3 (preferred) or a read-only SNMPv2c community. Cisco Packet Tracer devices usually don’t expose the IF-MIB counters needed, so use Demo mode for presentations.
        </EmptyState>
      ))}>
        {(rows) => (
          <Table>
            <thead className="bg-surface-2/50"><tr><Th>Target</Th><Th>Version</Th><Th>Area</Th><Th>Status</Th><Th>Last result</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
            <tbody>
              {rows.map((d) => {
                const t = tests[d.id]
                return (
                  <tr key={d.id}>
                    <td><Link to={`/network/devices/${d.id}`} className="font-medium hover:text-accent">{d.name}</Link><div className="num text-xs text-faint">{d.address}:{d.snmp?.port}</div></td>
                    <td className="text-xs">v{d.snmp?.version}{d.snmp?.version === '3' && d.snmp.username ? ` · ${d.snmp.username}` : ''}<div className="text-faint">{d.snmp?.has_community || d.snmp?.has_auth_key ? 'credentials stored' : 'no credentials'}</div></td>
                    <td className="text-muted">{d.location_name ?? 'n/a'}</td>
                    <td><StatusBadge status={d.status} /></td>
                    <td className="max-w-xs text-xs">
                      {t === 'running' ? <span className="text-muted">testing…</span> : t ? (
                        <span className={t.reachable ? 'text-ok' : 'text-crit'}>{t.reachable ? `OK · ${t.latency_ms} ms · ${t.interfaces ?? 0} interfaces` : t.error}</span>
                      ) : (
                        <span className={d.status === 'offline' ? 'text-crit' : 'text-muted'}>{d.status_reason ?? (d.last_seen_at ? `seen ${timeAgo(d.last_seen_at)}` : 'not polled yet')}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <Button size="sm" variant="ghost" onClick={() => test(d)} disabled={t === 'running'}><PlugZap size={13} /> Test</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(d)}>Edit</Button>
                      <Button size="sm" variant="ghost" onClick={() => setDeleting(d)} aria-label={`Delete ${d.name}`}><Trash2 size={13} /></Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Async>
      <div className="border-t border-line px-4 py-3 text-[11px] leading-relaxed text-faint">
        SNMPv2c sends the community string in clear text: use it only on an isolated lab network with a read-only community. Prefer SNMPv3 with authPriv (SHA + AES).
      </div>
      {editing && <SnmpForm device={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); devices.reload() }} />}
      <ConfirmDialog
        open={!!deleting}
        title={`Delete ${deleting?.name}?`}
        body="Removes the target, its interfaces and stored samples. Alerts are kept."
        confirmLabel="Delete target"
        busy={del.busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => del.run(async () => { await api.deleteDevice(deleting!.id); setDeleting(null); devices.reload() })}
      />
    </Card>
  )
}

function SnmpForm({ device, onClose, onSaved }: { device: Device | null; onClose: () => void; onSaved: () => void }) {
  const locations = useApi(() => api.locations('1h'), [], false)
  const [f, setF] = useState({
    name: device?.name ?? '',
    address: device?.address ?? '',
    device_type: device?.device_type ?? 'switch',
    location_id: String(device?.location_id ?? ''),
    snmp_port: String(device?.snmp?.port ?? 161),
    snmp_version: device?.snmp?.version ?? '3',
    snmp_community: '',
    snmp_username: device?.snmp?.username ?? '',
    snmp_auth_protocol: device?.snmp?.auth_protocol ?? 'SHA',
    snmp_auth_key: '',
    snmp_priv_protocol: device?.snmp?.priv_protocol ?? 'AES',
    snmp_priv_key: '',
    default_capacity_mbps: device?.default_capacity_bps ? String(device.default_capacity_bps / 1e6) : '',
    enabled: device?.enabled ?? true,
  })
  const save = useSave()
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const stored = (has?: boolean) => (device && has ? 'Stored. Leave blank to keep' : '')

  const submit = () => {
    const body: Record<string, unknown> = {
      name: f.name.trim(), address: f.address.trim(), device_type: f.device_type,
      location_id: f.location_id ? Number(f.location_id) : null, snmp_port: Number(f.snmp_port), snmp_version: f.snmp_version,
      default_capacity_bps: f.default_capacity_mbps ? Number(f.default_capacity_mbps) * 1e6 : null, enabled: f.enabled,
    }
    if (f.snmp_version === '2c') {
      if (f.snmp_community) body.snmp_community = f.snmp_community
    } else {
      body.snmp_username = f.snmp_username.trim()
      body.snmp_auth_protocol = f.snmp_auth_protocol
      body.snmp_priv_protocol = f.snmp_priv_protocol
      if (f.snmp_auth_key) body.snmp_auth_key = f.snmp_auth_key
      if (f.snmp_priv_key) body.snmp_priv_key = f.snmp_priv_key
    }
    return save.run(async () => {
      if (device) await api.updateDevice(device.id, body)
      else await api.createDevice(body)
      onSaved()
    })
  }

  return (
    <Dialog open onClose={onClose} title={device ? `Edit SNMP target · ${device.name}` : 'Add SNMP target'} wide>
      <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit() }} autoComplete="off">
        <label><span className="label">Name</span><input className="input w-full" required maxLength={80} value={f.name} onChange={set('name')} placeholder="CORE-SW-01" /></label>
        <label><span className="label">IP address or hostname</span><input className="input w-full" required value={f.address} onChange={set('address')} placeholder="192.168.10.2" /></label>
        <label>
          <span className="label">Device type</span>
          <select className="input w-full" value={f.device_type} onChange={set('device_type')}>
            {['router', 'switch', 'firewall', 'access_point', 'server', 'host', 'printer', 'other'].map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
          </select>
        </label>
        <label>
          <span className="label">Campus area</span>
          <select className="input w-full" value={f.location_id} onChange={set('location_id')}>
            <option value="">Unassigned</option>
            {(locations.data ?? []).filter((l) => l.id !== 0).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <label><span className="label">UDP port</span><input className="input w-full" type="number" min={1} max={65535} required value={f.snmp_port} onChange={set('snmp_port')} /></label>
        <label>
          <span className="label">SNMP version</span>
          <select className="input w-full" value={f.snmp_version} onChange={set('snmp_version')}>
            <option value="3">v3 (recommended)</option>
            <option value="2c">v2c (lab only, read-only community)</option>
          </select>
        </label>
        {f.snmp_version === '2c' ? (
          <label className="sm:col-span-2">
            <span className="label">Read-only community</span>
            <input className="input w-full" type="password" autoComplete="new-password" required={!device?.snmp?.has_community} value={f.snmp_community} onChange={set('snmp_community')} placeholder={stored(device?.snmp?.has_community)} />
          </label>
        ) : (
          <>
            <label className="sm:col-span-2"><span className="label">Username</span><input className="input w-full" required value={f.snmp_username} onChange={set('snmp_username')} /></label>
            <label>
              <span className="label">Auth protocol</span>
              <select className="input w-full" value={f.snmp_auth_protocol} onChange={set('snmp_auth_protocol')}><option>SHA</option><option>SHA256</option><option>MD5</option></select>
            </label>
            <label><span className="label">Auth key (min 8)</span><input className="input w-full" type="password" autoComplete="new-password" minLength={8} value={f.snmp_auth_key} onChange={set('snmp_auth_key')} placeholder={stored(device?.snmp?.has_auth_key)} /></label>
            <label>
              <span className="label">Privacy protocol</span>
              <select className="input w-full" value={f.snmp_priv_protocol} onChange={set('snmp_priv_protocol')}><option>AES</option><option>AES256</option><option>DES</option></select>
            </label>
            <label><span className="label">Privacy key (min 8)</span><input className="input w-full" type="password" autoComplete="new-password" minLength={8} value={f.snmp_priv_key} onChange={set('snmp_priv_key')} placeholder={stored(device?.snmp?.has_priv_key)} /></label>
          </>
        )}
        <label>
          <span className="label">Default link capacity (Mbps, optional)</span>
          <input className="input w-full" type="number" min={0.001} step="any" value={f.default_capacity_mbps} onChange={set('default_capacity_mbps')} placeholder="used when the device reports no speed" />
        </label>
        <div className="flex items-center justify-between self-end pb-2">
          <span className="text-sm text-muted">Polling enabled</span>
          <Toggle checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} label="Polling enabled" />
        </div>
        <div className="flex items-center justify-between gap-3 sm:col-span-2">
          <Msg m={save.msg} />
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={save.busy}>{device ? 'Save changes' : 'Add target'}</Button>
          </div>
        </div>
      </form>
    </Dialog>
  )
}

/* ---------- campus areas ---------- */
function Areas() {
  const locations = useApi(() => api.locations('1h'), [])
  const [editing, setEditing] = useState<Partial<Location> | null>(null)
  const [deleting, setDeleting] = useState<Location | null>(null)
  const save = useSave()
  const del = useSave()
  return (
    <Card title="Campus areas" subtitle="Buildings / departments with their subnet and VLAN. Demonstration defaults, edit freely." actions={<Button size="sm" onClick={() => setEditing({})}><Plus size={14} /> Add area</Button>} bodyClass="p-0">
      <Async state={locations} skeleton={<Skeleton className="m-4 h-24" />}>
        {(locs) => (
          <Table>
            <thead className="bg-surface-2/50"><tr><Th>Name</Th><Th>Subnet</Th><Th>VLAN</Th><Th>Description</Th><Th className="text-right">Devices</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
            <tbody>
              {locs.filter((l) => l.id !== 0).map((l) => (
                <tr key={l.id}>
                  <td className="font-medium">{l.name}</td>
                  <td className="num text-muted">{l.subnet ?? 'n/a'}</td>
                  <td className="num text-muted">{l.vlan ?? 'n/a'}</td>
                  <td className="max-w-xs truncate text-xs text-muted">{l.description}</td>
                  <td className="num text-right">{l.devices_total}</td>
                  <td className="whitespace-nowrap text-right">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(l)}>Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleting(l)} aria-label={`Delete ${l.name}`}><Trash2 size={13} /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Async>
      <Dialog open={!!editing} onClose={() => { setEditing(null); save.setMsg(null) }} title={editing?.id ? `Edit ${editing.name}` : 'Add campus area'}>
        {editing && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              const fd = new FormData(e.currentTarget)
              const body = {
                name: String(fd.get('name')).trim(),
                subnet: String(fd.get('subnet')).trim() || null,
                vlan: fd.get('vlan') ? Number(fd.get('vlan')) : null,
                description: String(fd.get('description')).trim() || null,
              }
              save.run(async () => {
                if (editing.id) await api.updateLocation(editing.id, body)
                else await api.createLocation(body)
                setEditing(null)
                locations.reload()
              })
            }}
          >
            <label className="block"><span className="label">Name</span><input name="name" className="input w-full" required maxLength={80} defaultValue={editing.name ?? ''} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label><span className="label">Subnet (CIDR)</span><input name="subnet" className="input w-full" placeholder="192.168.40.0/24" defaultValue={editing.subnet ?? ''} /></label>
              <label><span className="label">VLAN (1 to 4094)</span><input name="vlan" type="number" min={1} max={4094} className="input w-full" defaultValue={editing.vlan ?? ''} /></label>
            </div>
            <label className="block"><span className="label">Description</span><input name="description" className="input w-full" maxLength={255} defaultValue={editing.description ?? ''} /></label>
            <Msg m={save.msg} />
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" loading={save.busy}>Save</Button></div>
          </form>
        )}
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        title={`Delete ${deleting?.name}?`}
        body="Devices in this area become Unassigned. Their history is kept."
        confirmLabel="Delete area"
        busy={del.busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => del.run(async () => { await api.deleteLocation(deleting!.id); setDeleting(null); locations.reload() })}
      />
    </Card>
  )
}

/* ---------- demo data ---------- */
function DemoData() {
  const { refresh } = useRefresh()
  const [confirm, setConfirm] = useState<'reset' | 'clear' | null>(null)
  const act = useSave()
  return (
    <Card title="Demo data" subtitle="Synthetic campus used for presentations. Seeded once with a fixed seed and never duplicated on restart.">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => setConfirm('reset')}>Reset & reseed demo data</Button>
        <Button variant="danger" onClick={() => setConfirm('clear')}><Trash2 size={14} /> Clear demo data</Button>
        <Msg m={act.msg} />
      </div>
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'reset' ? 'Reset demo data?' : 'Clear demo data?'}
        body={confirm === 'reset'
          ? 'Deletes all demo devices, samples and alerts, then regenerates the synthetic history (takes a few seconds). Local and SNMP data are not touched.'
          : 'Deletes all demo devices, samples and alerts. Demo mode will show empty states until you reseed. Local and SNMP data are not touched.'}
        confirmLabel={confirm === 'reset' ? 'Reset & reseed' : 'Clear demo data'}
        busy={act.busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() =>
          act.run(async () => {
            if (confirm === 'reset') await api.resetDemo()
            else await api.clearDemo()
            setConfirm(null)
            refresh()
          }, confirm === 'reset' ? 'Demo data regenerated' : 'Demo data cleared')
        }
      />
    </Card>
  )
}
