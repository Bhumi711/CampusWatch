import { useEffect, useState } from 'react'
import { api } from '../api/client'

/** VLAN "patch cable" colour per campus area, keyed by id so a colour follows its area everywhere.
 *  Validated categorical slots (dataviz validator, dark surface #0f141b). */
export const AREA_COLORS = ['#3987e5', '#d95926', '#199e70', '#9085e9', '#d55181', '#c98500']
export const UNASSIGNED_COLOR = '#6b7787'
export const areaColor = (id: number | null | undefined) =>
  id ? AREA_COLORS[(id - 1) % AREA_COLORS.length] : UNASSIGNED_COLOR

export const INBOUND = '#1f9fbc'
export const OUTBOUND = '#d55181'

export type LinkLed = 'ok' | 'warn' | 'crit' | 'alarm' | 'off'

/** Link LED: device unreachable = alarm; no fresh data or port down = off; else utilization vs thresholds. */
export function linkLed(
  i: { stale: boolean; oper_status: string | null; utilization_pct: number | null; device_status: string },
  t: Thresholds,
): LinkLed {
  if (i.device_status === 'offline') return 'alarm'
  if (i.stale || i.device_status !== 'online' || (i.oper_status && i.oper_status !== 'up')) return 'off'
  if (i.utilization_pct === null) return 'ok'
  return i.utilization_pct >= t.crit ? 'crit' : i.utilization_pct >= t.warn ? 'warn' : 'ok'
}

/** Activity LED blink period in seconds: busier links blink faster. null = no traffic. */
export function blinkPeriod(totalBps: number | null): number | null {
  if (totalBps === null || totalBps < 1e3) return null
  return +(2.4 / (1 + Math.log10(Math.max(totalBps, 1e4) / 1e4))).toFixed(2)
}

export interface Thresholds {
  warn: number
  crit: number
}

let cached: Promise<Thresholds> | null = null
/** Congestion thresholds from settings (fetched once per page load; 70/90 until they arrive). */
export function useThresholds(): Thresholds {
  const [t, setT] = useState<Thresholds>({ warn: 70, crit: 90 })
  useEffect(() => {
    cached ??= api
      .settings()
      .then((s) => ({ warn: s.congestion_warning_pct, crit: s.congestion_critical_pct }))
      .catch(() => {
        cached = null
        return { warn: 70, crit: 90 }
      })
    cached.then(setT)
  }, [])
  return t
}
export const invalidateThresholds = () => {
  cached = null
}
