import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { axisTime, formatAxisBps, formatBps, formatTime } from '../lib/format'
import { INBOUND, OUTBOUND } from '../lib/network'

const GRID = '#1c2531'
const AXIS = '#2e3a4a'
const SURFACE = '#0f141b'

interface TipProps {
  active?: boolean
  label?: string | number
  payload?: ReadonlyArray<{ name?: string | number; value?: unknown; color?: string; dataKey?: unknown }>
  format: (v: number) => string
  withDate?: boolean
}

function ChartTooltip({ active, payload, label, format, withDate }: TipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-[6px] border border-line-strong bg-surface-2 px-3 py-2 text-xs shadow-xl">
      <div className="mb-1.5 font-medium text-muted">{formatTime(String(label), withDate)}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center justify-between gap-6">
          <span className="flex items-center gap-1.5 text-muted">
            <span className="h-0.5 w-3 rounded-full" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="num font-medium text-ink">{typeof p.value === 'number' ? format(p.value) : 'no data'}</span>
        </div>
      ))}
    </div>
  )
}

const axisProps = (bucket: number) => ({
  dataKey: 't',
  tickFormatter: (v: string) => axisTime(v, bucket),
  minTickGap: 48,
  tickLine: false,
  axisLine: { stroke: AXIS },
})

export function TrafficChart({ points, bucket, height = 260 }: {
  points: Array<{ t: string; in_bps: number | null; out_bps: number | null }>
  bucket: number
  height?: number
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="gIn" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={INBOUND} stopOpacity={0.22} />
            <stop offset="100%" stopColor={INBOUND} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gOut" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={OUTBOUND} stopOpacity={0.16} />
            <stop offset="100%" stopColor={OUTBOUND} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis {...axisProps(bucket)} />
        <YAxis tickFormatter={formatAxisBps} width={44} tickLine={false} axisLine={false} />
        <Tooltip content={(p) => <ChartTooltip {...p} format={(v) => formatBps(v)} withDate={bucket >= 900} />} />
        <Legend verticalAlign="top" align="right" height={28} iconType="plainline" iconSize={12} />
        <Area type="monotone" dataKey="in_bps" name="Inbound" stroke={INBOUND} strokeWidth={2} fill="url(#gIn)" activeDot={{ r: 4, stroke: SURFACE, strokeWidth: 2 }} isAnimationActive={false} connectNulls={false} />
        <Area type="monotone" dataKey="out_bps" name="Outbound" stroke={OUTBOUND} strokeWidth={2} fill="url(#gOut)" activeDot={{ r: 4, stroke: SURFACE, strokeWidth: 2 }} isAnimationActive={false} connectNulls={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function MultiLineChart({ points, series, bucket, height = 280, format = (v: number) => formatBps(v), yFormat }: {
  points: Array<Record<string, unknown>>
  series: Array<{ key: string; name: string; color: string }>
  bucket: number
  height?: number
  format?: (v: number) => string
  yFormat?: (v: number) => string
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis {...axisProps(bucket)} />
        <YAxis tickFormatter={yFormat ?? formatAxisBps} width={44} tickLine={false} axisLine={false} />
        <Tooltip content={(p) => <ChartTooltip {...p} format={format} withDate={bucket >= 900} />} />
        <Legend verticalAlign="top" align="right" height={28} iconType="plainline" iconSize={12} />
        {series.map((s) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: SURFACE, strokeWidth: 2 }} isAnimationActive={false} connectNulls={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

export function LocationBars({ data, height = 240 }: {
  data: Array<{ name: string; in_bps: number | null; out_bps: number | null }>
  height?: number
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }} barGap={2}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tickFormatter={formatAxisBps} tickLine={false} axisLine={{ stroke: AXIS }} />
        <YAxis type="category" dataKey="name" width={128} tickLine={false} axisLine={false} />
        <Tooltip
          cursor={{ fill: 'rgba(148,163,184,0.06)' }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <div className="rounded-[6px] border border-line-strong bg-surface-2 px-3 py-2 text-xs shadow-xl">
                <div className="mb-1 font-medium text-ink">{label}</div>
                {payload.map((p) => (
                  <div key={String(p.dataKey)} className="flex justify-between gap-6 text-muted">
                    <span>{p.name}</span>
                    <span className="num text-ink">{typeof p.value === 'number' ? formatBps(p.value) : 'no data'}</span>
                  </div>
                ))}
              </div>
            ) : null
          }
        />
        <Legend verticalAlign="top" align="right" height={28} iconType="plainline" iconSize={12} />
        <Bar dataKey="in_bps" name="Inbound" fill={INBOUND} radius={[0, 4, 4, 0]} maxBarSize={12} isAnimationActive={false} />
        <Bar dataKey="out_bps" name="Outbound" fill={OUTBOUND} radius={[0, 4, 4, 0]} maxBarSize={12} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function StackedBars({ points, series, bucket, height = 200 }: {
  points: Array<Record<string, unknown>>
  series: Array<{ key: string; name: string; color: string }>
  bucket: number
  height?: number
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis {...axisProps(bucket)} />
        <YAxis allowDecimals={false} width={32} tickLine={false} axisLine={false} />
        <Tooltip cursor={{ fill: 'rgba(148,163,184,0.06)' }} content={(p) => <ChartTooltip {...p} format={(v) => String(v)} withDate />} />
        <Legend verticalAlign="top" align="right" height={28} iconType="plainline" iconSize={12} />
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.name} stackId="a" fill={s.color} stroke={SURFACE} strokeWidth={1} maxBarSize={16} isAnimationActive={false} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
