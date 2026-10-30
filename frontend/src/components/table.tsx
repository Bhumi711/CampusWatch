import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { cx } from './ui'

export type SortState<K extends string> = { key: K; dir: 'asc' | 'desc' }

/** Client-side sort. null/undefined always sort last. */
export function useSort<T, K extends string>(rows: T[], initial: SortState<K>, get: (row: T, key: K) => unknown) {
  const [sort, setSort] = useState(initial)
  const sorted = useMemo(() => {
    const m = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const x = get(a, sort.key)
      const y = get(b, sort.key)
      if (x === y) return 0
      if (x === null || x === undefined) return 1
      if (y === null || y === undefined) return -1
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * m
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort])
  const toggle = (key: K) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : s.key === key ? 'desc' : 'asc' }))
  return { sorted, sort, toggle }
}

export function Th<K extends string>({ k, sort, onSort, children, className }: {
  k?: K
  sort?: SortState<K>
  onSort?: (k: K) => void
  children: ReactNode
  className?: string
}) {
  const active = k && sort?.key === k
  return (
    <th
      scope="col"
      aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={cx('whitespace-nowrap px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-faint', className)}
    >
      {k && onSort ? (
        <button type="button" onClick={() => onSort(k)} className={cx('inline-flex items-center gap-1 hover:text-ink', active && 'text-muted')}>
          {children}
          {active ? sort!.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : <ArrowUpDown size={12} className="opacity-40" />}
        </button>
      ) : (
        children
      )}
    </th>
  )
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-sm [&_tbody_tr]:border-t [&_tbody_tr]:border-line [&_td]:px-3 [&_td]:py-2.5">
        {children}
      </table>
    </div>
  )
}
