import * as React from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import { cn } from '@/lib/cn'

/**
 * The heading above a section of a page: a small title on the left, and an
 * optional link ("View all") or controls on the right.
 */
export function SectionHeader({
  title,
  icon,
  meta,
  href,
  linkLabel = 'View all',
  actions,
  as: Heading = 'h2',
  className,
}: {
  title: React.ReactNode
  icon?: React.ReactNode
  /** A short muted note beside the title — a count, a summary. */
  meta?: React.ReactNode
  href?: string
  linkLabel?: string
  actions?: React.ReactNode
  as?: 'h2' | 'h3'
  className?: string
}) {
  return (
    <div className={cn('mb-3 flex flex-wrap items-center justify-between gap-2', className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <Heading className="flex min-w-0 items-center gap-2 text-sm font-semibold [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-[var(--color-ink-faint)]">
          {icon}
          {title}
        </Heading>
        {meta && <div className="text-sm text-[var(--color-ink-muted)]">{meta}</div>}
      </div>
      {(href || actions) && (
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {href && (
            <Link
              href={href as Route}
              className="text-sm text-[var(--color-accent)] hover:underline"
            >
              {linkLabel}
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
