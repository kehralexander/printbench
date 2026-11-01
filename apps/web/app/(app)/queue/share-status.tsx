'use client'

import { useEffect, useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { CopyButton } from '@/components/ui/copy-button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { shareRequestStatus } from './actions'

/**
 * A link — and a QR code to scan off the screen — for whoever asked for the
 * print, showing how it is going without an account or anyone updating it.
 *
 * Opened from a queue row's "More" menu. Radix does not report a programmatic
 * open through onOpenChange, so the link is made in an effect on `open`.
 */
export function ShareStatusDialog({
  requestId,
  title,
  open,
  onOpenChange,
  onError,
}: {
  requestId: string
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onError: (message: string | null) => void
}) {
  const [path, setPath] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!open || path) return
    onError(null)
    startTransition(async () => {
      const result = await shareRequestStatus(requestId)
      if (!result.ok) {
        onError(result.error)
        onOpenChange(false)
        return
      }
      setPath(result.path)
    })
  }, [open, path, requestId, onError, onOpenChange])

  const url = path && typeof window !== 'undefined' ? `${window.location.origin}${path}` : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="sm"
        title={`Status link for ${title}`}
        description="Anyone with it can see this request’s progress, and nothing else."
      >
        {pending || !url || !path ? (
          <p className="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
            <Loader2 className="size-4 animate-spin" /> Making the link…
          </p>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${path}/qr`}
              alt={`QR code for ${url}`}
              className="mx-auto size-44 rounded bg-white p-2"
            />
            <div className="mt-3 flex items-center gap-1.5">
              <a
                href={path}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate text-sm text-[var(--color-accent)] hover:underline"
              >
                {url}
              </a>
              <CopyButton value={url} />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
