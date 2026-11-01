import * as React from 'react'
import { cn } from '@/lib/cn'

/** A multi-line Input: same border, focus and invalid states. */
export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)]',
        'placeholder:text-[var(--color-ink-faint)]',
        'transition-colors focus:border-[var(--color-accent)] disabled:opacity-50',
        'aria-[invalid=true]:border-[var(--color-danger)]',
        className,
      )}
      {...props}
    />
  )
})
