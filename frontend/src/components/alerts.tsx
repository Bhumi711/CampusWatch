import { CheckCircle2, CircleAlert, Cpu, Gauge, ServerCrash, Waves } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useApi } from '../hooks/useRefresh'
import { CATEGORY_LABEL, DETECTOR_LABEL, formatObserved, formatTime, timeAgo } from '../lib/format'
import type { Alert, RangeKey } from '../types'
import { TrafficChart } from './charts'
import { Badge, Button, KeyValue, SeverityBadge, Skeleton, SourceBadge, cx } from './ui'

export const CATEGORY_ICON = {
  congestion: Gauge,
  traffic_anomaly: Waves,
  device_unavailable: ServerCrash,
  collector_error: Cpu,
} as const

export function AlertRow({ a, onOpen }: { a: Alert; onOpen?: (a: Alert) => void }) {
  const Icon = CATEGORY_ICON[a.category] ?? CircleAlert
  const color = a.status === 'resolved' ? 'text-faint' : a.severity === 'critical' ? 'text-crit' : a.severity === 'warning' ? 'text-warn' : 'text-info'
  const body = (
    <>
      <Icon size={16} className={cx('mt-0.5 shrink-0', color)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cx('row-name truncate text-sm font-medium', a.status === 'resolved' ? 'text-muted' : 'text-ink')}>{a.title}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-faint">
          <span>{CATEGORY_LABEL[a.category]}</span>
          {a.location_name && <span>· {a.location_name}</span>}
          <span>· {timeAgo(a.updated_at)}</span>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <SeverityBadge severity={a.severity} />
        {a.status === 'resolved' ? <Badge>resolved</Badge> : a.acknowledged_at ? <Badge tone="ok">ack’d</Badge> : null}
      </div>
    </>
  )
  return onOpen ? (
    <div className="row-link rounded-[6px]">
      <button type="button" onClick={() => onOpen(a)} className="flex w-full items-start gap-3 px-3 py-2.5 text-left">
        {body}
      </button>
    </div>
  ) : (
    <div className="flex items-start gap-3 px-2 py-2.5">{body}</div>
  )
}

function rangeFor(iso: string): RangeKey {
  const age = (Date.now() - new Date(iso).getTime()) / 1000
  return age < 3000 ? '1h' : age < 20000 ? '6h' : age < 80000 ? '24h' : '7d'
}

export function AlertDetail({ alert, onChanged }: { alert: Alert; onChanged: (a: Alert) => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const range = rangeFor(alert.created_at)
  const traffic = useApi(
    () => (alert.interface_id ? api.traffic({ range, interface_id: alert.interface_id, source: 'all' }) : Promise.resolve(null)),
    [alert.id, range],
  )
  const ack = async () => {
    setBusy(true)
    setErr(null)
    try {
      onChanged(await api.acknowledge(alert.id))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const target = [alert.device_name, alert.interface_name].filter(Boolean).join(' · ')

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={alert.severity} />
        <Badge tone={alert.status === 'active' ? 'warn' : 'neutral'}>{alert.status}</Badge>
        <Badge>{CATEGORY_LABEL[alert.category]}</Badge>
        <SourceBadge mode={alert.source_mode} />
        {alert.acknowledged_at && <Badge tone="ok">acknowledged {timeAgo(alert.acknowledged_at)}</Badge>}
      </div>
      <div>
        <h3 className="text-base font-semibold">{alert.title}</h3>
        <p className="mt-2 rounded-lg border border-line bg-surface-2 p-3 text-sm leading-relaxed text-muted">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-faint">Why this fired</span>
          {alert.message}
        </p>
      </div>

      {(alert.observed_value !== null || alert.threshold !== null || alert.baseline !== null) && (
        <div className="grid grid-cols-3 gap-2">
          {([['Observed', alert.observed_value], ['Threshold', alert.threshold], ['Baseline', alert.baseline]] as const).map(([k, v]) => (
            <div key={k} className="rounded-lg border border-line bg-surface-2 p-3">
              <div className="text-[11px] uppercase tracking-wide text-faint">{k}</div>
              <div className="num mt-1 text-sm font-semibold">{v === null ? <span className="text-faint">n/a</span> : formatObserved(v, alert.unit)}</div>
            </div>
          ))}
        </div>
      )}

      <KeyValue
        items={[
          ['Detector', DETECTOR_LABEL[alert.detector] ?? alert.detector],
          ['Target', alert.device_id ? <Link className="text-accent hover:underline" to={`/network/devices/${alert.device_id}`}>{target || 'device'}</Link> : target || 'n/a'],
          ['Campus area', alert.location_name ?? 'n/a'],
          ['First raised', formatTime(alert.created_at, true)],
          ['Last updated', formatTime(alert.updated_at, true)],
          ['Resolved', alert.resolved_at ? formatTime(alert.resolved_at, true) : 'still active'],
          ['Occurrences', <span className="num">{alert.occurrences} (deduplicated)</span>],
        ]}
      />

      {alert.interface_id && (
        <div>
          <div className="mb-2 text-xs font-medium text-muted">Interface traffic, last {range}</div>
          {traffic.data ? (
            <TrafficChart points={traffic.data.points} bucket={traffic.data.bucket_seconds} height={180} />
          ) : (
            <Skeleton className="h-[180px]" />
          )}
        </div>
      )}

      {err && <p role="alert" className="text-xs text-crit">{err}</p>}
      <div className="flex justify-end">
        {alert.status === 'resolved' && !alert.acknowledged_at ? (
          <span className="text-sm text-muted">Resolved {formatTime(alert.resolved_at, true)}. No action needed.</span>
        ) : alert.acknowledged_at ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-ok">
            <CheckCircle2 size={16} /> Acknowledged {formatTime(alert.acknowledged_at, true)}
          </span>
        ) : (
          <Button onClick={ack} loading={busy}>
            <CheckCircle2 size={15} /> Acknowledge
          </Button>
        )}
      </div>
    </div>
  )
}
