import { AlertTriangle, Inbox, Loader2, RotateCw, X } from 'lucide-react'
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { useThresholds } from '../lib/network'
import type { DeviceStatus, Mode, Severity } from '../types'

export function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(' ')
}

/* ---------- layout ---------- */
export function Card({ title, subtitle, actions, children, className, bodyClass }: {
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClass?: string
}) {
  return (
    <section className={cx('card flex flex-col', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx('flex-1 p-4', bodyClass)}>{children}</div>
    </section>
  )
}

/** Re-mounts on every new value so the change latches in (the site's motion verb). */
export function Latch({ children, className }: { children: string | number; className?: string }) {
  return <span key={String(children)} className={cx('latch', className)}>{children}</span>
}

/* ---------- badges ---------- */
type Tone = 'neutral' | 'ok' | 'warn' | 'crit' | 'info' | 'accent' | 'demo'
const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-muted ring-line-strong',
  ok: 'bg-ok/10 text-ok ring-ok/25',
  warn: 'bg-warn/10 text-warn ring-warn/25',
  crit: 'bg-crit/10 text-crit ring-crit/25',
  info: 'bg-info/10 text-info ring-info/25',
  accent: 'bg-accent/10 text-accent ring-accent/25',
  demo: 'bg-demo/10 text-demo ring-demo/30',
}

export function Badge({ tone = 'neutral', children, className, title }: {
  tone?: Tone
  children: ReactNode
  className?: string
  title?: string
}) {
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-[3px] px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset', TONES[tone], className)}>
      {children}
    </span>
  )
}

const STATUS_TONE: Record<DeviceStatus, Tone> = { online: 'ok', offline: 'crit', unknown: 'neutral' }
export function StatusBadge({ status, title }: { status: DeviceStatus; title?: string }) {
  return (
    <Badge tone={STATUS_TONE[status]} title={title}>
      <span className={cx('size-1.5 rounded-full', status === 'online' ? 'bg-ok' : status === 'offline' ? 'bg-crit' : 'bg-faint')} />
      {status}
    </Badge>
  )
}

const SEV_TONE: Record<Severity, Tone> = { info: 'info', warning: 'warn', critical: 'crit' }
export function SeverityBadge({ severity }: { severity: Severity }) {
  return <Badge tone={SEV_TONE[severity]}>{severity}</Badge>
}

export function SourceBadge({ mode, compact }: { mode: Mode | string; compact?: boolean }) {
  if (mode === 'demo')
    return <Badge tone="demo" title="Synthetic data from the demo generator, not real campus traffic">{compact ? 'demo' : 'Demo · synthetic'}</Badge>
  if (mode === 'local') return <Badge tone="ok" title="Live counters from this computer (psutil)">{compact ? 'local' : 'Live · local machine'}</Badge>
  if (mode === 'snmp') return <Badge tone="accent" title="Live counters polled over SNMP">{compact ? 'snmp' : 'Live · SNMP'}</Badge>
  return <Badge>{mode}</Badge>
}

/* ---------- states ---------- */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-surface-3', className)} />
}

export function EmptyState({ title, children, icon, action }: { title: string; children?: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="text-faint">{icon ?? <Inbox size={28} />}</div>
      <p className="text-sm font-medium text-ink">{title}</p>
      {children && <div className="max-w-md text-xs leading-relaxed text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 px-6 py-8 text-center">
      <AlertTriangle className="text-crit" size={24} />
      <p className="text-sm font-medium text-ink">Couldn’t load data</p>
      <p className="max-w-md text-xs text-muted">{message}</p>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry} className="mt-1">
          <RotateCw size={14} className="travel-turn" /> Retry
        </Button>
      )}
    </div>
  )
}

/** Renders skeleton / error / children, keeping stale data visible during background refreshes. */
export function Async<T>({ state, children, skeleton, empty }: {
  state: { data: T | undefined; error: string | null; reload: () => void }
  children: (data: T) => ReactNode
  skeleton?: ReactNode
  empty?: (data: T) => ReactNode | null
}) {
  if (state.data === undefined) {
    if (state.error) return <ErrorState message={state.error} onRetry={state.reload} />
    return <>{skeleton ?? <Skeleton className="h-40 w-full" />}</>
  }
  const e = empty?.(state.data)
  return <>{e ?? children(state.data)}</>
}

/* ---------- controls ---------- */
export function Button({ variant = 'primary', size = 'md', loading, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  loading?: boolean
}) {
  const v = {
    primary: 'btn-flood bg-accent text-slate-950 font-semibold',
    secondary: 'icon-travel bg-surface-3 text-ink ring-1 ring-inset ring-line-strong hover:bg-line-strong',
    ghost: 'icon-travel text-muted hover:bg-surface-3 hover:text-ink',
    danger: 'icon-travel bg-crit/15 text-crit ring-1 ring-inset ring-crit/30 hover:bg-crit/25',
  }[variant]
  const s = size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3.5 text-sm'
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || loading}
      className={cx('inline-flex items-center justify-center gap-1.5 rounded-[6px] font-medium transition-colors active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50', v, s, className)}
    >
      {loading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T
  options: Array<{ key: T; label: string }>
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[6px] bg-surface-2 p-0.5 ring-1 ring-inset ring-line">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          onClick={() => onChange(o.key)}
          className={cx(
            'seg num h-7 rounded-[4px] px-2.5 text-xs font-medium transition-colors',
            value === o.key ? 'bg-accent/15 text-accent ring-1 ring-inset ring-accent/40' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Select({ label, value, onChange, children, className }: {
  label: string
  value: string
  onChange: (v: string) => void
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cx('inline-flex w-44 items-center', className)}>
      <span className="sr-only">{label}</span>
      <select aria-label={label} className="input h-8 w-full pr-8 text-xs" value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </label>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx('relative h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-accent-strong' : 'bg-line-strong')}
    >
      <span className={cx('absolute top-0.5 left-0 size-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-4.5' : 'translate-x-0.5')} />
    </button>
  )
}

export function Meter({ value, bare }: { value: number | null; bare?: boolean }) {
  const { warn, crit } = useThresholds()
  if (value === null) return <span className="text-xs text-faint" title="Link capacity unknown, so utilization is not calculated">n/a</span>
  const color = value >= crit ? 'bg-crit' : value >= warn ? 'bg-warn' : 'bg-ok'
  return (
    <div className="flex items-center gap-2" title={`${value.toFixed(1)}% utilization`}>
      <div className={cx('h-1.5 overflow-hidden rounded-[2px] bg-surface-3', bare ? 'w-full max-w-56' : 'w-16')}>
        <div className={cx('h-full', color)} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
      {!bare && <span className="num w-11 text-right text-xs text-ink">{value.toFixed(1)}%</span>}
    </div>
  )
}

/* ---------- dialogs (native <dialog>: focus trap + Esc for free) ---------- */
export function Dialog({ open, onClose, title, children, side, wide }: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  side?: boolean
  wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx(
        'border border-line-strong bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-[2px]',
        side
          ? 'fixed inset-y-0 right-0 left-auto m-0 h-full max-h-none w-full max-w-xl rounded-none border-y-0 border-r-0'
          : cx('m-auto w-[calc(100%-2rem)] rounded-[6px]', wide ? 'max-w-2xl' : 'max-w-md'),
      )}
    >
      {open && (
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
            <h2 className="text-sm font-semibold">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted hover:bg-surface-3 hover:text-ink">
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-5">{children}</div>
        </div>
      )}
    </dialog>
  )
}

export function ConfirmDialog({ open, title, body, confirmLabel, onConfirm, onCancel, busy }: {
  open: boolean
  title: string
  body: ReactNode
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
}) {
  return (
    <Dialog open={open} onClose={onCancel} title={title}>
      <div className="text-sm leading-relaxed text-muted">{body}</div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button variant="danger" onClick={onConfirm} loading={busy}>{confirmLabel}</Button>
      </div>
    </Dialog>
  )
}

export function Tabs<T extends string>({ value, onChange, tabs }: {
  value: T
  onChange: (v: T) => void
  tabs: Array<{ key: T; label: string; count?: number }>
}) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line whitespace-nowrap">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          type="button"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={cx(
            '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
            value === t.key ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="num ml-1.5 rounded bg-surface-3 px-1.5 text-[11px] text-muted">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function KeyValue({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[minmax(0,9rem)_1fr] gap-x-4 gap-y-2 text-sm">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  )
}
