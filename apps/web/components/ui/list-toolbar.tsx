import * as React from 'react'
import { cn } from '@/lib/cn'

/**
 * The row directly above a list: filters or search on the left, the sort
 * control on the right. Lists with filter pills use `FilterTabs`' `trailing`
 * slot for the sort instead; either way it sits in the same place.
 */
export function ListToolbar({
  children,
  sort,
  className,
}: {
  children?: React.ReactNode
  sort?: React.ReactNode
  className?: string
}) {
  return (
    // Collapses entirely when every slot rendered nothing — a sort control
    // hides itself on a list too short to order.
    <div
      className={cn(
        'mb-4 flex flex-wrap items-center gap-3 [&:not(:has(>:not(:empty)))]:hidden',
        className,
      )}
    >
      {children && (
        <div className="flex w-full min-w-0 flex-wrap items-center gap-3 empty:hidden sm:w-auto sm:flex-1">
          {children}
        </div>
      )}
      {sort && <div className="ml-auto flex items-center empty:hidden">{sort}</div>}
    </div>
  )
}
