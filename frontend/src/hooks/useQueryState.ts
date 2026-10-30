import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

/** A single URL search param as state, so filters survive refresh and are shareable. */
export function useQueryState<T extends string = string>(key: string, fallback: NoInfer<T>): [T, (v: T | "") => void] {
  const [params, setParams] = useSearchParams()
  const value = (params.get(key) as T | null) ?? fallback
  const set = useCallback(
    (v: T | '') =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (v === '' || v === fallback) next.delete(key)
          else next.set(key, v)
          return next
        },
        { replace: true },
      ),
    [key, fallback, setParams],
  )
  return [value, set]
}
