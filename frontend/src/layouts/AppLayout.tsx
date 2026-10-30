import { BarChart3, Bell, LayoutDashboard, Network, Pause, Play, RefreshCw, Settings, TriangleAlert } from 'lucide-react'
import { useEffect, useState, type CSSProperties } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { api } from '../api/client'
import { Badge, SourceBadge, cx } from '../components/ui'
import { useApi, useRefresh } from '../hooks/useRefresh'
import { formatTime, timeAgo } from '../lib/format'
import type { CollectorStatus } from '../types'

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/network', label: 'Network & Devices', icon: Network },
  { to: '/analytics', label: 'Traffic Analytics', icon: BarChart3 },
  { to: '/alerts', label: 'Anomalies & Alerts', icon: Bell },
  { to: '/settings', label: 'Settings', icon: Settings },
]

const HEALTH = { ok: ['bg-ok', 'text-ok'], warn: ['bg-warn', 'text-warn'], crit: ['bg-crit', 'text-crit'], faint: ['bg-faint', 'text-faint'] } as const

function pageTitle(path: string) {
  if (path.startsWith('/network/devices/')) return 'Device detail'
  return NAV.find((n) => (n.end ? path === n.to : path.startsWith(n.to)))?.label ?? 'Not found'
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(id)
  }, [ms])
  return now
}

/** A hairline that fills until the collector's next sample: real time-to-poll, not decoration. */
function SampleSweep({ c }: { c: CollectorStatus }) {
  if (!c.running || !c.next_poll_at) return null
  const interval = c.poll_interval_seconds
  const remaining = Math.min(interval, Math.max(0, (new Date(c.next_poll_at).getTime() - Date.now()) / 1000))
  const elapsed = interval - remaining
  return (
    <span aria-hidden="true" className="absolute inset-x-0 bottom-[-1px] h-px overflow-hidden">
      <span
        key={c.next_poll_at}
        className="sweep block h-full bg-accent/70"
        style={{ '--interval': `${interval}s`, '--offset': `-${elapsed}s`, '--progress': elapsed / interval } as CSSProperties}
      />
    </span>
  )
}

/** Always one line tall, so the page never jumps when the data source becomes known. */
function SourceStrip({ c, error }: { c: CollectorStatus | undefined; error: string | null }) {
  const base = 'flex h-8 items-center gap-2 overflow-hidden border-t px-4 text-xs whitespace-nowrap lg:px-6'
  if (!c && error)
    return (
      <div role="alert" className={cx(base, 'border-crit/30 bg-crit/10 text-crit')}>
        <TriangleAlert size={14} className="shrink-0" /> <span className="truncate">Backend unreachable: {error}</span>
      </div>
    )
  if (!c) return <div className={cx(base, 'border-line text-faint')}>Connecting to the collector…</div>
  if (c.mode === 'demo')
    return (
      <div className={cx(base, 'border-demo/20 bg-[#140d18] text-demo')}>
        <Badge tone="demo">Demo data</Badge>
        <span className="truncate">
          Synthetic traffic, not real campus measurements.<span className="hidden md:inline"> Switch to Local or SNMP in Settings for live data.</span>
        </span>
      </div>
    )
  return (
    <div className={cx(base, 'border-line bg-surface text-muted')}>
      <Badge tone="ok">Live data</Badge>
      <span className="truncate">{c.mode === 'local' ? 'Real counters from this computer’s network interfaces.' : 'Counters polled over SNMP from the configured devices.'}</span>
    </div>
  )
}

export default function AppLayout() {
  const { pathname } = useLocation()
  const { refresh, inflight, lastUpdated, auto, setAuto, setIntervalSeconds } = useRefresh()
  const collector = useApi(api.collector, [])
  const alerts = useApi(() => api.summary().then((s) => s.alerts), [])
  const now = useNow()
  const c = collector.data
  const title = pageTitle(pathname)

  useEffect(() => {
    if (c) setIntervalSeconds(c.poll_interval_seconds)
  }, [c, setIntervalSeconds])
  useEffect(() => {
    document.title = `${title} · CampusWatch`
  }, [title])

  const lastRunFailed = c?.last_run && !c.last_run.success
  const health = !c ? 'faint' : !c.running ? 'crit' : lastRunFailed ? 'warn' : 'ok'
  const [healthBg, healthText] = HEALTH[health]

  return (
    <div className="flex min-h-screen">
      <a href="#main" className="sr-only z-50 rounded-[6px] bg-accent px-3 py-2 text-sm font-semibold text-slate-950 focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to content
      </a>
      <aside className="sticky top-0 flex h-screen w-16 shrink-0 flex-col border-r border-line bg-surface lg:w-60">
        <div className="flex h-14 items-center gap-3 border-b border-line px-4">
          <span aria-hidden="true" className="relative grid size-8 shrink-0 place-items-center rounded-[4px] border border-line-strong bg-[#06080c]">
            <span className="absolute top-1.5 left-1.5 size-1.5 rounded-full bg-ok" />
            <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-warn" />
            <span className="mt-2.5 h-1.5 w-3 rounded-t-[2px] border border-b-0 border-line-strong bg-surface-2" />
          </span>
          <div className="hidden leading-tight lg:block">
            <div className="text-[15px] font-semibold tracking-[-0.01em]" style={{ fontStretch: '88%' }}>CampusWatch</div>
            <div className="text-[11px] text-faint">Smart Campus Monitor</div>
          </div>
        </div>
        <nav aria-label="Main" className="flex-1 space-y-0.5 p-2">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              viewTransition
              title={label}
              className={({ isActive }) =>
                cx(
                  'nav-link group flex h-10 items-center gap-3 rounded-[6px] px-3 text-sm font-medium transition-colors',
                  isActive ? 'bg-surface-3 text-ink' : 'text-muted hover:bg-surface-2 hover:text-ink',
                )
              }
            >
              <span className="nav-led hidden size-1.5 shrink-0 rounded-full lg:block" aria-hidden="true" />
              <Icon size={17} className="shrink-0 text-faint group-aria-[current=page]:text-accent lg:hidden" />
              <span className="nav-label hidden flex-1 truncate lg:block">{label}</span>
              {to === '/alerts' && !!alerts.data?.active && (
                <span className={cx('num hidden rounded-[3px] px-1.5 text-[11px] font-semibold lg:inline', alerts.data.critical ? 'bg-crit/20 text-crit' : 'bg-warn/15 text-warn')}>
                  {alerts.data.active}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="hidden border-t border-line p-4 text-xs lg:block">
          <div className="mb-2 flex items-center gap-2">
            <span className={cx('size-1.5 rounded-full', healthBg, health === 'ok' && 'animate-pulse')} aria-hidden="true" />
            <span className="text-muted">
              Collector{' '}
              <span className={healthText}>{!c ? 'connecting' : !c.running ? 'stopped' : lastRunFailed ? 'reporting errors' : 'running'}</span>
            </span>
          </div>
          <div className="num text-faint">
            Last poll {c?.last_run ? timeAgo(c.last_run.started_at, now) : 'never'}
            {c && <> · every {c.poll_interval_seconds}s</>}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
          <div className="relative flex h-14 items-center justify-between gap-3 px-4 lg:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <h1 className="truncate text-[17px] font-semibold tracking-[-0.015em]">{title}</h1>
              {c && <SourceBadge mode={c.mode} />}
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden text-xs text-faint sm:inline" title={lastUpdated ? new Date(lastUpdated).toLocaleString() : undefined}>
                Updated <span className="num text-muted">{lastUpdated ? formatTime(new Date(lastUpdated).toISOString()) : 'n/a'}</span>
              </span>
              <button
                type="button"
                onClick={() => setAuto(!auto)}
                aria-pressed={auto}
                title={auto ? 'Auto-refresh is on. Click to pause.' : 'Auto-refresh is paused. Click to resume.'}
                className="icon-travel inline-flex h-8 items-center gap-1.5 rounded-[6px] px-2.5 text-xs text-muted ring-1 ring-inset ring-line hover:bg-surface-2 hover:text-ink"
              >
                {auto ? <Pause size={13} className="travel-y" /> : <Play size={13} className="travel-x" />}
                <span className="hidden md:inline">{auto ? `Auto ${c?.poll_interval_seconds ?? 10}s` : 'Paused'}</span>
              </button>
              <button
                type="button"
                onClick={refresh}
                aria-label="Refresh now"
                className="icon-travel inline-flex h-8 items-center gap-1.5 rounded-[6px] bg-surface-3 px-2.5 text-xs font-medium text-ink ring-1 ring-inset ring-line-strong hover:bg-line-strong"
              >
                <RefreshCw size={13} className={cx('travel-turn', inflight > 0 && 'animate-spin')} />
                <span className="hidden sm:inline">Refresh</span>
              </button>
            </div>
            {c && <SampleSweep c={c} />}
          </div>
          <SourceStrip c={c} error={collector.error} />
        </header>

        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1600px] flex-1 p-4 outline-none lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
