import type { Route } from 'next'
import Link from 'next/link'
import { cn } from '@/lib/cn'

/**
 * One headline figure: the dashboard's counts, a Diagnostics page's problems
 * of one kind, whether a process is up. The tone says how worried to be; with
 * an `href` the tile is also a link or filter, and `active` marks the one
 * applied. An `icon` sits to the left of the figure.
 */
export function StatTile({
  value,
  label,
  hint,
  icon: Icon,
  tone = 'neutral',
  href,
  active = false,
}: {
  value: React.ReactNode
  label: string
  hint?: string
  icon?: React.ComponentType<{ className?: string }>
  tone?: 'neutral' | 'warning' | 'danger'
  href?: string
  active?: boolean
}) {
  const className = cn(
    'block rounded-[var(--radius-card)] border p-4',
    tone === 'danger'
      ? 'border-[var(--color-danger)] bg-[var(--color-danger-soft)] text-[var(--color-danger)]'
      : tone === 'warning'
        ? 'border-[var(--color-warning)] bg-[var(--color-surface)] text-[var(--color-ink)]'
        : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-ink)]',
    href && 'transition-shadow hover:shadow-[var(--shadow-card)]',
    active && 'ring-2 ring-[var(--color-accent)]',
  )

  const figure = (
    <span className="block min-w-0">
      <span className="block text-2xl font-semibold leading-none tabular-nums">{value}</span>
      <span className="mt-1 block truncate text-sm font-medium">{label}</span>
      {hint && <span className="mt-0.5 block text-xs opacity-80">{hint}</span>}
    </span>
  )
  const body = Icon ? (
    <span className="flex items-center gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-surface-2)] text-[var(--color-ink-faint)]">
        <Icon className="size-4" />
      </span>
      {figure}
    </span>
  ) : (
    figure
  )

  return href ? (
    <Link href={href as Route} aria-current={active ? 'page' : undefined} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  )
}
