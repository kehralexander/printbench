import * as React from 'react'
import { cn } from '@/lib/cn'

/**
 * A boxed note inside a page: a hint ("info"), something to watch ("warning")
 * or something wrong ("danger").
 */
export function Callout({
  tone = 'info',
  icon,
  title,
  children,
  className,
}: {
  tone?: 'info' | 'warning' | 'danger'
  icon?: React.ReactNode
  title?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : undefined}
      className={cn(
        'flex gap-3 rounded-[var(--radius-control)] px-3 py-2.5 text-sm',
        tone === 'danger'
          ? 'border border-[var(--color-danger)] bg-[var(--color-danger-soft)] text-[var(--color-ink)]'
          : tone === 'warning'
            ? 'border border-[color-mix(in_oklch,var(--color-warning)_45%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_12%,transparent)] text-[var(--color-ink)]'
            : 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]',
        className,
      )}
    >
      {icon && (
        <span
          className={cn(
            'mt-0.5 shrink-0 [&_svg]:size-4',
            tone === 'danger' && 'text-[var(--color-danger)]',
            tone === 'warning' && 'text-[var(--color-warning)]',
          )}
        >
          {icon}
        </span>
      )}
      <div className="min-w-0 space-y-1">
        {title && <p className="font-medium text-[var(--color-ink)]">{title}</p>}
        {children}
      </div>
    </div>
  )
}
