import * as React from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import { cn } from '@/lib/cn'

/**
 * A row of pill links that switch a list between views ("Open", "Done",
 * "Everything"), with room on the right for the list's other controls — its
 * sort, a reset button.
 */
export function FilterTabs({
  options,
  current,
  trailing,
  label = 'Filter',
  className,
}: {
  options: readonly { key: string; label: string; href: string }[]
  current: string
  trailing?: React.ReactNode
  label?: string
  className?: string
}) {
  return (
    <nav aria-label={label} className={cn('mb-4 flex flex-wrap items-center gap-1.5', className)}>
      {options.map((option) => {
        const active = option.key === current
        return (
          <Link
            key={option.key}
            href={option.href as Route}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-full px-3 py-1 text-sm transition-colors',
              active
                ? 'bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]'
                : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]',
            )}
          >
            {option.label}
          </Link>
        )
      })}
      {/* On a phone the pills take the row and the sort gets its own line
          below them, right-aligned like every other sort. */}
      {trailing && (
        <div className="ml-auto flex basis-full flex-wrap items-center justify-end gap-2 empty:hidden sm:basis-auto">
          {trailing}
        </div>
      )}
    </nav>
  )
}
