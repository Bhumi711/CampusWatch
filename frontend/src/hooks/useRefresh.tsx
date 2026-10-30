import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

interface RefreshCtx {
  tick: number
  refresh: () => void
  auto: boolean
  setAuto: (v: boolean) => void
  intervalSeconds: number
  setIntervalSeconds: (s: number) => void
  lastUpdated: number | null
  inflight: number
  track: <T>(p: Promise<T>) => Promise<T>
}

const Ctx = createContext<RefreshCtx | null>(null)

/** One clock for the whole app: the header refresh button and the auto-refresh timer bump `tick`. */
export function RefreshProvider({ children }: { children: ReactNode }) {
  const [tick, setTick] = useState(0)
  const [auto, setAuto] = useState(true)
  const [intervalSeconds, setIntervalSeconds] = useState(10)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [inflight, setInflight] = useState(0)
  const refresh = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    if (!auto) return
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, Math.max(5, intervalSeconds) * 1000)
    return () => window.clearInterval(id)
  }, [auto, intervalSeconds, refresh])

  const track = useCallback(<T,>(p: Promise<T>) => {
    setInflight((n) => n + 1)
    return p
      .then((v) => {
        setLastUpdated(Date.now())
        return v
      })
      .finally(() => setInflight((n) => n - 1))
  }, [])

  const value = useMemo(
    () => ({ tick, refresh, auto, setAuto, intervalSeconds, setIntervalSeconds, lastUpdated, inflight, track }),
    [tick, refresh, auto, intervalSeconds, lastUpdated, inflight, track],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useRefresh() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useRefresh outside RefreshProvider')
  return c
}

interface ApiState<T> {
  data: T | undefined
  error: string | null
  loading: boolean
  reload: () => void
}

/** Fetches on mount, when `deps` change (clearing stale data) and on every global refresh tick (keeping data). */
export function useApi<T>(fn: () => Promise<T>, deps: unknown[] = [], live = true): ApiState<T> {
  const { tick, track } = useRefresh()
  const [data, setData] = useState<T>()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)
  const seq = useRef(0)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const key = JSON.stringify(deps)
  const lastKey = useRef(key)

  useEffect(() => {
    if (lastKey.current !== key) {
      lastKey.current = key
      setData(undefined)
    }
    const my = ++seq.current
    setLoading(true)
    track(fnRef.current())
      .then((d) => {
        if (my !== seq.current) return
        setData(d)
        setError(null)
      })
      .catch((e: Error) => my === seq.current && setError(e.message))
      .finally(() => my === seq.current && setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, live ? tick : 0, nonce, track])

  return { data, error, loading, reload: useCallback(() => setNonce((n) => n + 1), []) }
}
