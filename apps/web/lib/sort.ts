/**
 * Shared plumbing for sortable lists. The control itself is
 * `components/ui/sort-control.tsx`; this is the part servers can import.
 */

export interface SortOption<T extends string = string> {
  value: T
  label: string
}

/** The chosen sort from a search param, or the fallback when it is missing or unknown. */
export function pickSort<T extends string>(
  raw: string | string[] | undefined,
  options: readonly SortOption<T>[],
  fallback: T,
): T {
  const value = Array.isArray(raw) ? raw[0] : raw
  return options.some((option) => option.value === value) ? (value as T) : fallback
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

/** Case-insensitive, number-aware text comparison — "Part 2" before "Part 10". */
export function compareText(a: string | null | undefined, b: string | null | undefined): number {
  return collator.compare(a ?? '', b ?? '')
}

/** Comparison of nullable dates or numbers, newest/largest first, missing values last. */
export function compareDesc(
  a: Date | number | string | null | undefined,
  b: Date | number | string | null | undefined,
): number {
  const x = toNumber(a)
  const y = toNumber(b)
  if (x === null && y === null) return 0
  if (x === null) return 1
  if (y === null) return -1
  return y - x
}

/** As `compareDesc`, oldest/smallest first, missing values still last. */
export function compareAsc(
  a: Date | number | string | null | undefined,
  b: Date | number | string | null | undefined,
): number {
  const x = toNumber(a)
  const y = toNumber(b)
  if (x === null && y === null) return 0
  if (x === null) return 1
  if (y === null) return -1
  return x - y
}

function toNumber(value: Date | number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return value
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? null : time
}
