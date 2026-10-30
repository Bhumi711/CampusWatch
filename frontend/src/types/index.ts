// Mirrors backend/app/schemas. Timestamps are ISO-8601 UTC strings.
export type Mode = 'demo' | 'local' | 'snmp'
export type SourceFilter = Mode | 'all'
export type RangeKey = '15m' | '1h' | '6h' | '24h' | '7d'
export type DeviceStatus = 'online' | 'offline' | 'unknown'
export type Severity = 'info' | 'warning' | 'critical'
export type AlertCategory = 'congestion' | 'traffic_anomaly' | 'device_unavailable' | 'collector_error'

export interface Summary {
  source_mode: string
  synthetic: boolean
  generated_at: string
  devices: { total: number; online: number; offline: number; unknown: number }
  traffic: {
    in_bps: number | null
    out_bps: number | null
    interfaces_reporting: number
    interfaces_total: number
    as_of: string | null
  }
  utilization: {
    links_with_capacity: number
    average_pct: number | null
    max_pct: number | null
    max_interface: { interface_id: number; name: string; device_id: number; device_name: string } | null
  }
  alerts: { active: number; info: number; warning: number; critical: number; unacknowledged: number }
}

export interface Location {
  id: number
  name: string
  subnet: string | null
  vlan: number | null
  description: string | null
}

export interface LocationSummary extends Location {
  devices_total: number
  devices_online: number
  devices_offline: number
  devices_unknown: number
  in_bps: number | null
  out_bps: number | null
  avg_total_bps: number | null
  peak_total_bps: number | null
  max_utilization_pct: number | null
  active_alerts: number
}

export interface Interface {
  id: number
  device_id: number
  name: string
  alias: string | null
  if_index: number | null
  capacity_bps: number | null
  capacity_source: string | null
  oper_status: string | null
  counter_bits: number
  in_bps: number | null
  out_bps: number | null
  utilization_pct: number | null
  updated_at: string | null
  stale: boolean
}

export interface InterfaceRow extends Interface {
  device_name: string
  device_status: DeviceStatus
  location_id: number | null
  location_name: string | null
  source_mode: Mode
}

export interface SnmpInfo {
  port: number
  version: string
  username: string | null
  auth_protocol: string | null
  priv_protocol: string | null
  has_community: boolean
  has_auth_key: boolean
  has_priv_key: boolean
}

export interface Device {
  id: number
  name: string
  address: string
  device_type: string
  location_id: number | null
  location_name: string | null
  subnet: string | null
  vlan: number | null
  source_mode: Mode
  enabled: boolean
  status: DeviceStatus
  status_reason: string | null
  last_seen_at: string | null
  cpu_pct: number | null
  memory_pct: number | null
  interface_count: number
  in_bps: number | null
  out_bps: number | null
  max_utilization_pct: number | null
  default_capacity_bps: number | null
  snmp: SnmpInfo | null
}

export interface DeviceDetail extends Device {
  interfaces: Interface[]
  active_alerts: number
}

export interface TrafficPoint {
  t: string
  in_bps: number | null
  out_bps: number | null
}

export interface TrafficSeries {
  range: RangeKey
  bucket_seconds: number
  source_mode: string
  points: TrafficPoint[]
}

export interface GroupInfo {
  key: string
  name: string
  avg_total_bps: number | null
  peak_total_bps: number | null
  avg_in_bps: number | null
  avg_out_bps: number | null
}

export interface GroupedSeries {
  range: RangeKey
  bucket_seconds: number
  source_mode: string
  groups: GroupInfo[]
  points: Array<{ t: string } & Record<string, number | string | null>>
}

export interface TopItem {
  interface_id: number | null
  device_id: number
  name: string
  device_name: string
  location_name: string | null
  avg_in_bps: number | null
  avg_out_bps: number | null
  peak_total_bps: number | null
  max_utilization_pct: number | null
  est_bytes: number | null
}

export interface DeviceMetrics {
  range: RangeKey
  bucket_seconds: number
  interfaces: Array<{
    interface_id: number
    name: string
    alias: string | null
    points: Array<TrafficPoint & { utilization_pct: number | null }>
  }>
  system: Array<{ t: string; cpu_pct: number | null; memory_pct: number | null }>
}

export interface Alert {
  id: number
  created_at: string
  updated_at: string
  resolved_at: string | null
  acknowledged_at: string | null
  category: AlertCategory
  severity: Severity
  status: 'active' | 'resolved'
  detector: string
  title: string
  message: string
  device_id: number | null
  interface_id: number | null
  location_id: number | null
  device_name: string | null
  interface_name: string | null
  location_name: string | null
  observed_value: number | null
  threshold: number | null
  baseline: number | null
  unit: string | null
  source_mode: Mode
  occurrences: number
}

export interface AlertPage {
  total: number
  items: Alert[]
}

export interface AlertStats {
  range: RangeKey
  bucket_seconds: number
  source_mode: string
  by_category: Record<AlertCategory, number>
  by_severity: Record<Severity, number>
  timeline: Array<{ t: string } & Record<AlertCategory, number>>
}

export interface Settings {
  collection_mode: Mode
  poll_interval_seconds: number
  congestion_warning_pct: number
  congestion_critical_pct: number
  congestion_consecutive_samples: number
  anomaly_zscore_threshold: number
  anomaly_min_ratio: number
  anomaly_window_samples: number
  anomaly_min_bps: number
  ml_enabled: boolean
  ml_contamination: number
  alert_cooldown_seconds: number
  retention_days: number
  modes: Mode[]
  demo_seed: number
  demo_history_hours: number
  snmp_timeout_seconds: number
  snmp_retries: number
}

export interface CollectorRun {
  id: number
  mode: Mode
  trigger: string
  started_at: string
  finished_at: string | null
  success: boolean
  error: string | null
  devices_polled: number
  devices_failed: number
  samples_written: number
  details: Array<{ device_id?: number; device?: string; error?: string; note?: string }>
}

export interface CollectorStatus {
  mode: Mode
  synthetic: boolean
  poll_interval_seconds: number
  running: boolean
  polling_now: boolean
  next_poll_at: string | null
  last_run: CollectorRun | null
  last_success_at: string | null
}

export interface DetectionStatus {
  source_mode: Mode
  rule_based: { enabled: boolean; method: string; window_samples: number; zscore_threshold: number; min_ratio: number; min_bps: number }
  congestion: { warning_pct: number; critical_pct: number; consecutive_samples: number }
  isolation_forest: {
    enabled: boolean
    trained: boolean
    trained_at: string | null
    contamination: number
    score_threshold: number | null
    training_samples: number
    source_mode: Mode | null
    synthetic: boolean
    min_training_samples: number
    features: string[]
    message: string
    active_for_mode: boolean
  }
}

export interface SnmpTestResult {
  reachable: boolean
  error: string | null
  sys_descr: string | null
  latency_ms: number | null
  interfaces: number | null
  cpu_pct: number | null
  memory_pct: number | null
}
