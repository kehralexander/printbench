import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/cn'

const badge = cva(
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
  {
    variants: {
      tone: {
        neutral:
          'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)] ring-[var(--color-border)]',
        accent: 'bg-[var(--color-accent-soft)] text-[var(--color-accent)] ring-transparent',
        danger: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)] ring-transparent',
        warning:
          'bg-[color-mix(in_oklch,var(--color-warning)_16%,transparent)] text-[var(--color-ink)] ring-[color-mix(in_oklch,var(--color-warning)_45%,transparent)]',
        success:
          'bg-[color-mix(in_oklch,var(--color-success)_14%,transparent)] text-[var(--color-success)] ring-transparent',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export function Badge({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ tone }), className)} {...props} />
}
