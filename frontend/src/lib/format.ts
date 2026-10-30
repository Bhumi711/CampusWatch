export function formatBps(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return 'n/a'
  const units: Array<[string, number]> = [['Gbps', 1e9], ['Mbps', 1e6], ['Kbps', 1e3]]
  for (const [u, d] of units) if (Math.abs(v) >= d) return `${(v / d).toFixed(digits)} ${u}`
  return `${v.toFixed(0)} bps`
}

/** Value and unit separately, for instrument numerals: ["469.2", "Mbps"]. */
export function splitBps(v: number | null | undefined): [string, string] {
  const s = formatBps(v)
  const i = s.lastIndexOf(' ')
  return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)]
}

/** Compact axis label: 450M, 1.4G. */
export function formatAxisBps(v: number): string {
  for (const [u, d] of [['G', 1e9], ['M', 1e6], ['K', 1e3]] as const)
    if (Math.abs(v) >= d) return `${+(v / d).toFixed(1)}${u}`
  return String(Math.round(v))
}

export function formatBytes(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'n/a'
  const units: Array<[string, number]> = [['TB', 1e12], ['GB', 1e9], ['MB', 1e6], ['KB', 1e3]]
  for (const [u, d] of units) if (Math.abs(v) >= d) return `${(v / d).toFixed(1)} ${u}`
  return `${v.toFixed(0)} B`
}

export const formatPct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined ? 'n/a' : `${v.toFixed(digits)}%`

export function formatTime(iso: string | null | undefined, withDate = false): string {
  if (!iso) return 'n/a'
  const d = new Date(iso)
  return withDate
    ? d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function axisTime(iso: string, bucketSeconds: number): string {
  const d = new Date(iso)
  if (bucketSeconds >= 3600) return d.toLocaleString([], { weekday: 'short', hour: '2-digit' })
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never'
  const s = Math.round((now - new Date(iso).getTime()) / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

export function formatObserved(value: number | null, unit: string | null): string {
  if (value === null) return 'n/a'
  if (unit === 'bps') return formatBps(value)
  if (unit === '%') return formatPct(value)
  if (unit === 'score') return value.toFixed(3)
  return String(value)
}

export const MODE_LABEL: Record<string, string> = {
  demo: 'Demo (synthetic)',
  local: 'Local machine',
  snmp: 'SNMP devices',
  all: 'All sources',
}

export const CATEGORY_LABEL: Record<string, string> = {
  congestion: 'Congestion',
  traffic_anomaly: 'Traffic anomaly',
  device_unavailable: 'Device unavailable',
  collector_error: 'Collector error',
}

export const DETECTOR_LABEL: Record<string, string> = {
  threshold: 'Utilization threshold',
  rolling_zscore: 'Rolling baseline (z-score)',
  isolation_forest: 'Isolation Forest (ML)',
  availability: 'Availability check',
  collector: 'Collector health',
}

export const RANGES: Array<{ key: import('../types').RangeKey; label: string }> = [
  { key: '15m', label: '15m' },
  { key: '1h', label: '1h' },
  { key: '6h', label: '6h' },
  { key: '24h', label: '24h' },
  { key: '7d', label: '7d' },
]
