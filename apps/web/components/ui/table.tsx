import * as React from 'react'
import { cn } from '@/lib/cn'

/**
 * A data table inside a Card: full-bleed rows, small uppercase headers,
 * dividers between rows. Wrap in `<Card className="overflow-hidden">`.
 * Scrolls sideways on narrow screens rather than squashing columns.
 */
export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full text-sm', className)} {...props} />
    </div>
  )
}

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        'border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wider text-[var(--color-ink-faint)]',
        className,
      )}
      {...props}
    />
  )
}

export function TBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody
      className={cn('divide-y divide-[var(--color-border)] tabular-nums', className)}
      {...props}
    />
  )
}

export function TR(props: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr {...props} />
}

export function TH({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className={cn('whitespace-nowrap px-3 py-2.5 font-medium sm:px-4', className)} {...props} />
  )
}

export function TD({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-3 py-3 align-middle sm:px-4', className)} {...props} />
}
