'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { createShareLink, revokeShareLink } from './share-actions'

/**
 * Share this model by link.
 *
 * The link is minted on demand rather than shown on every model page, because
 * an unshared model has no link and pretending otherwise would suggest the
 * whole library is public.
 */
export function ShareDialog({
  publicId,
  shareUrl,
  open,
  onOpenChange,
}: {
  publicId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Built on the server, which knows the configured public address. */
  shareUrl: string | null
}) {
  const router = useRouter()
  const [url, setUrl] = useState(shareUrl)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function share() {
    setError(null)
    startTransition(async () => {
      const result = await createShareLink(publicId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setUrl(result.url)
      router.refresh()
    })
  }

  function revoke() {
    if (!confirm('Revoke this link? Anyone holding it will lose access immediately.')) return
    startTransition(async () => {
      const result = await revokeShareLink(publicId)
      if (!result.ok) setError(result.error ?? 'That did not work.')
      else {
        setUrl(null)
        router.refresh()
      }
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setError(null)
      }}
    >
      <DialogContent size="sm" title="Share by link" className="space-y-2">
        {url ? (
          <>
            <p className="text-xs text-[var(--color-ink-muted)]">
              Anyone with this link can view and download this model. Nothing else.
            </p>
            <Input
              readOnly
              aria-label="Share link"
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="h-8 bg-[var(--color-surface-2)] px-2 font-mono text-xs"
            />
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="text-[var(--color-danger)]"
                onClick={revoke}
                disabled={pending}
              >
                <Trash2 />
                Revoke
              </Button>
              <CopyButton value={url} label="Copy" />
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-[var(--color-ink-muted)]">
              Creates a private link to this model that works without an account.
            </p>
            <div className="flex justify-end">
              <Button size="sm" onClick={share} disabled={pending}>
                {pending && <Loader2 className="animate-spin" />}
                Create a link
              </Button>
            </div>
          </>
        )}

        {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
      </DialogContent>
    </Dialog>
  )
}
