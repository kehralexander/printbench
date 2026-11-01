'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from './button'

/**
 * A modal panel. Root, Trigger and Close are Radix's own; `DialogContent`
 * brings the overlay, the panel, and a header with title, description and a
 * close button, so every dialog in the app has the same frame.
 */
export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

const SIZES = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl' } as const

export const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  Omit<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, 'title'> & {
    title: React.ReactNode
    description?: React.ReactNode
    size?: keyof typeof SIZES
    /** Hide the close button, e.g. while a save is running. */
    hideClose?: boolean
  }
>(function DialogContent(
  {
    className,
    title,
    description,
    size = 'md',
    hideClose = false,
    children,
    onOpenAutoFocus,
    ...props
  },
  ref,
) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[oklch(0%_0_0/0.5)]" />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto',
          'rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-pop)] outline-none',
          SIZES[size],
          className,
        )}
        {...(description ? {} : { 'aria-describedby': undefined })}
        onOpenAutoFocus={(event) => {
          onOpenAutoFocus?.(event)
          if (event.defaultPrevented) return
          /*
           * Radix focuses the first focusable thing, which is the close button
           * in the header — so every dialog opened with a ring around its X.
           * Start on the first field to fill in instead, or on the panel itself
           * (Tab then reaches the X first, as before).
           */
          event.preventDefault()
          const panel = event.currentTarget as HTMLElement
          const field = panel.querySelector<HTMLElement>(
            'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])',
          )
          ;(field ?? panel).focus({ preventScroll: true })
        }}
        {...props}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-base font-semibold tracking-tight">
              {title}
            </DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description className="mt-1 text-sm text-[var(--color-ink-muted)]">
                {description}
              </DialogPrimitive.Description>
            )}
          </div>
          {!hideClose && (
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close" className="-mr-2 -mt-2">
                <X />
              </Button>
            </DialogPrimitive.Close>
          )}
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
})
