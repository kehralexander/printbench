'use client'

import { useState, useTransition } from 'react'
import { Check, Copy, Link2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { shareRequestStatus } from './actions'

/**
 * A link — and a QR code to scan off the screen — for whoever asked for the
 * print, showing how it is going without an account or anyone updating it.
 */
export function ShareStatus({
  requestId,
  title,
  disabled,
  onError,
}: {
  requestId: string
  title: string
  disabled: boolean
  onError: (message: string | null) => void
}) {
  const [path, setPath] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [pending, startTransition] = useTransition()

  function load(open: boolean) {
    if (!open || path) return
    onError(null)
    startTransition(async () => {
      const result = await shareRequestStatus(requestId)
      if (!result.ok) {
        onError(result.error)
        return
      }
      setPath(result.path)
    })
  }

  const url = path && typeof window !== 'undefined' ? `${window.location.origin}${path}` : null

  return (
    <Popover onOpenChange={load}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label={`Status link for ${title}`}
          title="Status link for whoever asked"
        >
          <Link2 />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3">
        <p className="text-sm font-medium">Status link</p>
        <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
          Anyone with it can see this request&rsquo;s progress, and nothing else.
        </p>
        {pending || !url || !path ? (
          <p className="mt-3 flex items-center gap-2 text-xs text-[var(--color-ink-muted)]">
            <Loader2 className="size-3 animate-spin" /> Making the link…
          </p>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${path}/qr`}
              alt={`QR code for ${url}`}
              className="mx-auto mt-3 size-44 rounded bg-white p-2"
            />
            <div className="mt-3 flex items-center gap-1.5">
              <a
                href={path}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate text-xs text-[var(--color-accent)] hover:underline"
              >
                {url}
              </a>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Copy the link"
                onClick={() => {
                  void navigator.clipboard?.writeText(url).then(() => setCopied(true))
                }}
              >
                {copied ? <Check /> : <Copy />}
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
