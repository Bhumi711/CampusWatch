import type {
  Alert, AlertPage, AlertStats, CollectorRun, CollectorStatus, DetectionStatus, Device, DeviceDetail,
  DeviceMetrics, GroupedSeries, InterfaceRow, Location, LocationSummary, RangeKey, Settings, SnmpTestResult,
  SourceFilter, Summary, TopItem, TrafficSeries,
} from '../types'

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

type Params = Record<string, string | number | boolean | null | undefined>

function qs(params?: Params): string {
  if (!params) return ''
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

function describe(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail))
    return detail
      .map((d) => {
        const loc = Array.isArray(d?.loc) ? d.loc.filter((x: unknown) => x !== 'body').join('.') : ''
        return loc ? `${loc}: ${d.msg}` : String(d?.msg ?? d)
      })
      .join('; ')
  return 'Request failed'
}

async function request<T>(method: string, path: string, body?: unknown, params?: Params): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}${qs(params)}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'Cannot reach the backend. Is it running on port 8000?')
  }
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, describe(data?.detail) || `HTTP ${res.status}`)
  return data as T
}

const get = <T>(path: string, params?: Params) => request<T>('GET', path, undefined, params)
const V = '/api/v1'

export const api = {
  health: () => get<{ status: string; mode: string; collector_running: boolean }>('/health'),
  summary: () => get<Summary>(`${V}/summary`),
  traffic: (p: { range: RangeKey; location_id?: number | null; device_id?: number | null; interface_id?: number | null; source?: SourceFilter }) =>
    get<TrafficSeries>(`${V}/metrics/traffic`, p),
  trafficByLocation: (range: RangeKey) => get<GroupedSeries>(`${V}/metrics/traffic/by-location`, { range }),
  top: (range: RangeKey, by: 'interface' | 'device', limit = 8) => get<TopItem[]>(`${V}/metrics/top`, { range, by, limit }),

  locations: (range: RangeKey = '1h') => get<LocationSummary[]>(`${V}/locations`, { range }),
  createLocation: (b: Partial<Location>) => request<Location>('POST', `${V}/locations`, b),
  updateLocation: (id: number, b: Partial<Location>) => request<Location>('PATCH', `${V}/locations/${id}`, b),
  deleteLocation: (id: number) => request<void>('DELETE', `${V}/locations/${id}`),

  devices: (p?: Params) => get<Device[]>(`${V}/devices`, p),
  device: (id: number) => get<DeviceDetail>(`${V}/devices/${id}`),
  deviceMetrics: (id: number, range: RangeKey) => get<DeviceMetrics>(`${V}/devices/${id}/metrics`, { range }),
  createDevice: (b: Record<string, unknown>) => request<DeviceDetail>('POST', `${V}/devices`, b),
  updateDevice: (id: number, b: Record<string, unknown>) => request<DeviceDetail>('PATCH', `${V}/devices/${id}`, b),
  deleteDevice: (id: number) => request<void>('DELETE', `${V}/devices/${id}`),
  testDevice: (id: number) => request<SnmpTestResult>('POST', `${V}/devices/${id}/test`),

  interfaces: (p?: Params) => get<InterfaceRow[]>(`${V}/interfaces`, p),
  updateInterface: (id: number, b: { alias?: string | null; capacity_bps?: number | null }) =>
    request<InterfaceRow>('PATCH', `${V}/interfaces/${id}`, b),

  alerts: (p?: Params) => get<AlertPage>(`${V}/alerts`, p),
  alert: (id: number) => get<Alert>(`${V}/alerts/${id}`),
  acknowledge: (id: number) => request<Alert>('POST', `${V}/alerts/${id}/acknowledge`),
  alertStats: (range: RangeKey) => get<AlertStats>(`${V}/alerts/stats`, { range }),

  settings: () => get<Settings>(`${V}/settings`),
  updateSettings: (b: Partial<Settings>) => request<Settings>('PATCH', `${V}/settings`, b),
  collector: () => get<CollectorStatus>(`${V}/collector/status`),
  collectorRuns: (limit = 10) => get<CollectorRun[]>(`${V}/collector/runs`, { limit }),
  pollNow: () => request<CollectorRun>('POST', `${V}/collector/poll`),
  detection: () => get<DetectionStatus>(`${V}/detection/status`),
  trainModel: () => request<DetectionStatus>('POST', `${V}/detection/ml/train`),
  resetDemo: () => request<{ seeded: boolean }>('POST', `${V}/demo/reset`, { confirm: true }),
  clearDemo: () => request<{ cleared: boolean }>('POST', `${V}/demo/clear`, { confirm: true }),
}
