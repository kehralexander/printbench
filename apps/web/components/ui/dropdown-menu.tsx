'use client'

import * as React from 'react'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { cn } from '@/lib/cn'

/**
 * A menu of actions behind one trigger. Used where a screen has more actions
 * than it can show as buttons: the everyday ones stay visible, the rest go
 * here.
 */
export const DropdownMenu = DropdownMenuPrimitive.Root
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

export const DropdownMenuContent = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(function DropdownMenuContent({ className, align = 'end', sideOffset = 6, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={12}
        className={cn(
          'z-50 min-w-48 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 shadow-[var(--shadow-pop)]',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
})

export const DropdownMenuItem = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    tone?: 'default' | 'danger'
  }
>(function DropdownMenuItem({ className, tone = 'default', ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Item
      ref={ref}
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none [&_svg]:size-4 [&_svg]:shrink-0',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        tone === 'danger'
          ? 'text-[var(--color-danger)] data-[highlighted]:bg-[var(--color-danger-soft)]'
          : 'text-[var(--color-ink-muted)] data-[highlighted]:bg-[var(--color-surface-2)] data-[highlighted]:text-[var(--color-ink)]',
        className,
      )}
      {...props}
    />
  )
})

export function DropdownMenuSeparator({ className }: { className?: string }) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn('my-1.5 h-px bg-[var(--color-border)]', className)}
    />
  )
}
