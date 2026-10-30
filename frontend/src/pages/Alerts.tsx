import { BrainCircuit, CheckCircle2, ChevronLeft, ChevronRight, Gauge, Waves } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { api } from '../api/client'
import { AlertDetail, CATEGORY_ICON } from '../components/alerts'
import { Table, Th } from '../components/table'
import { Async, Badge, Button, Card, Dialog, EmptyState, SeverityBadge, Skeleton, Select, SourceBadge } from '../components/ui'
import { useApi } from '../hooks/useRefresh'
import { useQueryState } from '../hooks/useQueryState'
import { CATEGORY_LABEL, DETECTOR_LABEL, RANGES, formatBps, formatObserved, formatTime, timeAgo } from '../lib/format'
import type { Alert, DetectionStatus } from '../types'

const PAGE = 25

export default function Alerts() {
  const [severity, setSeverity] = useQueryState('severity', '')
  const [category, setCategory] = useQueryState('category', '')
  const [status, setStatus] = useQueryState('status', '')
  const [ack, setAck] = useQueryState('ack', '')
  const [range, setRange] = useQueryState('range', '')
  const [source, setSource] = useQueryState('source', '')
  const [page, setPage] = useQueryState('page', '0')
  const [openId, setOpenId] = useQueryState('alert', '')
  const filters = { severity, category, status, acknowledged: ack, range, source, limit: PAGE, offset: Number(page) * PAGE }
  const alerts = useApi(() => api.alerts(filters), [JSON.stringify(filters)])
  const open = useApi(() => (openId ? api.alert(Number(openId)) : Promise.resolve(null)), [openId], false)
  const [acking, setAcking] = useState<number | null>(null)

  const setFilter = (fn: (v: string) => void) => (v: string) => {
    fn(v)
    setPage('0')
  }
  const acknowledge = async (a: Alert) => {
    setAcking(a.id)
    try {
      await api.acknowledge(a.id)
      alerts.reload()
    } finally {
      setAcking(null)
    }
  }
  const total = alerts.data?.total ?? 0
  const pageNo = Number(page)

  return (
    <div className="space-y-4">
      <DetectorPanel />

      <div className="flex flex-wrap items-center gap-2">
        <Select label="Severity" value={severity} onChange={setFilter(setSeverity)}>
          <option value="">All severities</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="info">Info</option>
        </Select>
        <Select label="Category" value={category} onChange={setFilter(setCategory)}>
          <option value="">All categories</option>
          {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select label="Status" value={status} onChange={setFilter(setStatus)}>
          <option value="">Active & resolved</option><option value="active">Active</option><option value="resolved">Resolved</option>
        </Select>
        <Select label="Acknowledgement" value={ack} onChange={setFilter(setAck)}>
          <option value="">Any ack state</option><option value="false">Unacknowledged</option><option value="true">Acknowledged</option>
        </Select>
        <Select label="Time range" value={range} onChange={setFilter(setRange)}>
          <option value="">All time</option>
          {RANGES.map((r) => <option key={r.key} value={r.key}>Last {r.label}</option>)}
        </Select>
        <Select label="Data source" value={source} onChange={setFilter(setSource)}>
          <option value="">Active source</option><option value="all">All sources</option><option value="demo">Demo</option><option value="local">Local</option><option value="snmp">SNMP</option>
        </Select>
      </div>

      <Card bodyClass="p-0">
        <Async
          state={alerts}
          skeleton={<Skeleton className="m-4 h-72" />}
          empty={(d) => (d.items.length ? null : <EmptyState title="No alerts match these filters">Alerts appear when a detector fires: congestion, traffic spikes, unreachable devices or collector errors.</EmptyState>)}
        >
          {(d) => (
            <>
              <Table>
                <thead className="bg-surface-2/50">
                  <tr><Th>Severity</Th><Th>Alert</Th><Th>Detector</Th><Th className="text-right">Observed / threshold</Th><Th>Raised</Th><Th>State</Th><Th><span className="sr-only">Actions</span></Th></tr>
                </thead>
                <tbody>
                  {d.items.map((a) => {
                    const Icon = CATEGORY_ICON[a.category]
                    return (
                      <tr key={a.id} className="row-link">
                        <td><SeverityBadge severity={a.severity} /></td>
                        <td className="max-w-md">
                          <button type="button" onClick={() => setOpenId(String(a.id))} className="flex items-start gap-2 text-left">
                            <Icon size={15} className="mt-0.5 shrink-0 text-faint" />
                            <span>
                              <span className="row-name font-medium">{a.title}</span>
                              <span className="block text-xs text-faint">{CATEGORY_LABEL[a.category]} · {a.location_name ?? 'no area'}</span>
                            </span>
                          </button>
                        </td>
                        <td className="text-xs text-muted">{DETECTOR_LABEL[a.detector] ?? a.detector}</td>
                        <td className="num text-right text-xs">
                          <div className="text-ink">{formatObserved(a.observed_value, a.unit)}</div>
                          <div className="text-faint">{a.threshold !== null ? `≥ ${formatObserved(a.threshold, a.unit)}` : 'n/a'}</div>
                        </td>
                        <td className="whitespace-nowrap text-xs text-muted" title={formatTime(a.created_at, true)}>
                          {timeAgo(a.created_at)}
                          {a.occurrences > 1 && <div className="text-faint">{a.occurrences}× seen</div>}
                        </td>
                        <td>
                          <div className="flex flex-col items-start gap-1">
                            <Badge tone={a.status === 'active' ? 'warn' : 'neutral'}>{a.status}</Badge>
                            {a.acknowledged_at && <Badge tone="ok">ack’d</Badge>}
                            {source === 'all' && <SourceBadge mode={a.source_mode} compact />}
                          </div>
                        </td>
                        <td className="text-right">
                          {!a.acknowledged_at && a.status === 'active' && (
                            <Button size="sm" variant="secondary" loading={acking === a.id} onClick={() => acknowledge(a)}>
                              <CheckCircle2 size={13} /> Ack
                            </Button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
              <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-xs text-muted">
                <span className="num">{pageNo * PAGE + 1} to {Math.min(total, (pageNo + 1) * PAGE)} of {total}</span>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" disabled={pageNo === 0} onClick={() => setPage(String(pageNo - 1))} aria-label="Previous page"><ChevronLeft size={14} /></Button>
                  <Button size="sm" variant="ghost" disabled={(pageNo + 1) * PAGE >= total} onClick={() => setPage(String(pageNo + 1))} aria-label="Next page"><ChevronRight size={14} /></Button>
                </div>
              </div>
            </>
          )}
        </Async>
      </Card>

      <Dialog side open={!!openId} onClose={() => setOpenId('')} title="Alert details">
        {open.error ? (
          <p className="text-sm text-crit">{open.error}</p>
        ) : open.data ? (
          <AlertDetail alert={open.data} onChanged={() => { open.reload(); alerts.reload() }} />
        ) : (
          <Skeleton className="h-64" />
        )}
      </Dialog>
    </div>
  )
}

function DetectorPanel() {
  const det = useApi(api.detection, [])
  const [training, setTraining] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const train = async () => {
    setTraining(true)
    setErr(null)
    try {
      await api.trainModel()
      det.reload()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setTraining(false)
    }
  }
  return (
    <Async state={det} skeleton={<div className="grid grid-cols-1 gap-3 lg:grid-cols-3">{[0, 1, 2].map((k) => <Skeleton key={k} className="h-[140px]" />)}</div>}>
      {(d: DetectionStatus) => {
        const f = d.isolation_forest
        return (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Panel icon={<Gauge size={16} />} title="Congestion (threshold)" state="active">
              Warning ≥ <b className="text-ink">{d.congestion.warning_pct}%</b>, critical ≥ <b className="text-ink">{d.congestion.critical_pct}%</b> link utilization for {d.congestion.consecutive_samples} consecutive samples. Needs a known link capacity; one alert per link, resolved when it drops below the warning level.
            </Panel>
            <Panel icon={<Waves size={16} />} title="Traffic spikes (rule-based)" state="active">
              Flags a sample when it is ≥ <b className="text-ink">{d.rule_based.zscore_threshold}σ</b> and ≥ <b className="text-ink">{d.rule_based.min_ratio}×</b> above the interface’s rolling baseline of the last {d.rule_based.window_samples} samples (ignores links under {formatBps(d.rule_based.min_bps, 0)}).
            </Panel>
            <Panel
              icon={<BrainCircuit size={16} />}
              title="Isolation Forest (ML)"
              state={!f.enabled ? 'disabled' : f.active_for_mode ? 'active' : 'not trained'}
              action={f.enabled && <Button size="sm" variant="secondary" loading={training} onClick={train}>{f.trained ? 'Retrain' : 'Train now'}</Button>}
            >
              {f.message}
              {f.trained && f.score_threshold !== null && <> Flags scores above {f.score_threshold.toFixed(3)} (rarest {(f.contamination * 100).toFixed(2)}%).</>}
              {f.trained && f.source_mode !== d.source_mode && <span className="mt-1 block text-warn">Trained on {f.source_mode} data, so it is not used for the active {d.source_mode} source until retrained.</span>}
              {err && <span className="mt-1 block text-crit">{err}</span>}
            </Panel>
          </div>
        )
      }}
    </Async>
  )
}

function Panel({ icon, title, state, children, action }: { icon: ReactNode; title: string; state: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold"><span className="text-accent">{icon}</span>{title}</div>
        <div className="flex items-center gap-2">
          {action}
          <Badge tone={state === 'active' ? 'ok' : state === 'disabled' ? 'neutral' : 'warn'}>{state}</Badge>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-muted">{children}</p>
    </div>
  )
}
