import * as React from 'react'
import { cn } from '@/lib/cn'

/** A native checkbox in the app's accent colour, sized to sit beside text-sm. */
export const Checkbox = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>
>(function Checkbox({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      type="checkbox"
      className={cn(
        'size-4 shrink-0 cursor-pointer rounded border-[var(--color-border-strong)] accent-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
})
