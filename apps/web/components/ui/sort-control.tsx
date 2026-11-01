'use client'

import { useTransition } from 'react'
import type { Route } from 'next'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ArrowDownUp, Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { SortOption } from '@/lib/sort'

/**
 * The one sort control every sortable list uses: a "Sort" label and a compact
 * native select, so ordering looks and behaves the same on every page.
 *
 * Controlled — pass `value` and `onChange` for a list sorted in the browser.
 * For a server-rendered list use `UrlSortControl`, which keeps the choice in
 * the URL.
 */
export function SortControl<T extends string>({
  options,
  value,
  onChange,
  count,
  pending = false,
  className,
}: {
  options: readonly SortOption<T>[]
  value: T
  onChange: (value: T) => void
  /** How many items the list holds. Fewer than two have no order to choose, so nothing renders. */
  count?: number
  pending?: boolean
  className?: string
}) {
  if (count !== undefined && count < 2) return null
  return (
    <label
      className={cn(
        'inline-flex shrink-0 items-center gap-2 text-sm text-[var(--color-ink-muted)]',
        className,
      )}
    >
      {pending ? (
        <Loader2 aria-hidden className="size-4 animate-spin text-[var(--color-ink-faint)]" />
      ) : (
        <ArrowDownUp aria-hidden className="size-4 text-[var(--color-ink-faint)]" />
      )}
      <span>Sort</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className={cn(
          'h-9 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm text-[var(--color-ink)]',
          'transition-colors hover:bg-[var(--color-surface-2)] focus:border-[var(--color-accent)]',
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/**
 * A SortControl whose value lives in the `sort` search param, for lists the
 * server orders. The default option drops the param so plain URLs stay plain,
 * and any paging param is cleared — page 4 of a different order is meaningless.
 */
export function UrlSortControl<T extends string>({
  options,
  value,
  defaultValue,
  param = 'sort',
  count,
  className,
}: {
  options: readonly SortOption<T>[]
  value: T
  defaultValue: T
  param?: string
  /** See SortControl. */
  count?: number
  className?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  function change(next: T) {
    const params = new URLSearchParams(searchParams.toString())
    if (next === defaultValue) params.delete(param)
    else params.set(param, next)
    for (const paging of ['page', 'after', 'before', 'cursor']) params.delete(paging)
    const query = params.toString()
    startTransition(() => {
      router.push((query ? `${pathname}?${query}` : pathname) as Route, { scroll: false })
    })
  }

  return (
    <SortControl
      options={options}
      value={value}
      onChange={change}
      // A list that shrank under a non-default order keeps the control, so
      // there is always a way back.
      count={value === defaultValue ? count : undefined}
      pending={pending}
      className={className}
    />
  )
}
