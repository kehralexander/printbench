import { cn } from '@/lib/cn'

/**
 * A horizontal bar for anything with a fill level: a print's progress, the
 * filament left on a spool. One component so they all read the same.
 *
 * `value` is a fraction from 0 to 1; anything outside is clamped.
 */
export function Progress({
  value,
  label,
  valueText,
  tone = 'accent',
  size = 'md',
  animated = false,
  className,
}: {
  value: number
  label: string
  valueText?: string
  tone?: 'accent' | 'warning' | 'danger'
  size?: 'sm' | 'md'
  /** Glide between updates — for values that tick, like a live print. */
  animated?: boolean
  className?: string
}) {
  const percent = Math.max(0, Math.min(100, value * 100))
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      aria-valuetext={valueText}
      className={cn(
        'overflow-hidden rounded-full bg-[var(--color-surface-2)]',
        size === 'sm' ? 'h-1.5' : 'h-2',
        className,
      )}
    >
      <div
        className={cn(
          'h-full rounded-full',
          tone === 'danger'
            ? 'bg-[var(--color-danger)]'
            : tone === 'warning'
              ? 'bg-[var(--color-warning)]'
              : 'bg-[var(--color-accent)]',
          animated && 'transition-[width] duration-1000 ease-linear motion-reduce:transition-none',
        )}
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}
