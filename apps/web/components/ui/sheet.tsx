'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from './button'

/**
 * A panel that slides in from the right edge, for the details of one row of a
 * list: the list stays in view beside it, which a centred dialog would cover.
 * Radix's Dialog underneath, so focus, Escape and the overlay behave as in
 * every dialog in the app.
 */
export const Sheet = DialogPrimitive.Root

export const SheetContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  Omit<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, 'title'> & {
    title: React.ReactNode
    description?: React.ReactNode
  }
>(function SheetContent({ className, title, description, children, ...props }, ref) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[oklch(0%_0_0/0.35)]" />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col',
          'border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-pop)] outline-none',
          className,
        )}
        {...(description ? {} : { 'aria-describedby': undefined })}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] p-5">
          <div className="min-w-0">
            <DialogPrimitive.Title className="truncate text-base font-semibold tracking-tight">
              {title}
            </DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description className="mt-1 text-sm text-[var(--color-ink-muted)]">
                {description}
              </DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="icon" aria-label="Close" className="-mr-2 -mt-2">
              <X />
            </Button>
          </DialogPrimitive.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
})
