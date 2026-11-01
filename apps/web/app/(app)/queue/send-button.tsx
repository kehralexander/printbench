'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { sendRequestToPrinter } from './actions'
import type { SendTarget } from './request-row'

/**
 * Sends the request's sliced file to a printer and starts it, from the queue
 * row, so working the queue does not mean a trip to the model page.
 *
 * Always a confirming step — it starts a printer — and the printer list says
 * which ones were busy at the worker's last look; the server asks the printer
 * again before sending.
 */
export function SendButton({
  requestId,
  title,
  filename,
  targets,
  disabled,
  onError,
}: {
  requestId: string
  title: string
  filename: string
  targets: SendTarget[]
  disabled: boolean
  onError: (message: string | null) => void
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  function send(target: SendTarget) {
    onError(null)
    setMessage(null)
    startTransition(async () => {
      const result = await sendRequestToPrinter(requestId, target.id)
      if (!result.ok) {
        onError(result.error)
        setOpen(false)
        return
      }
      setMessage(result.message)
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || pending}
          aria-label={`Send ${title} to a printer and start it`}
          title={message ?? 'Send the sliced file to a printer and start it'}
        >
          {pending ? <Loader2 className="animate-spin" /> : <Send />}
          <span className="hidden sm:inline">Send &amp; start</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3">
        <p className="text-sm font-medium">Print {filename.split('/').pop()}?</p>
        <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
          The file is sent and the print starts straight away. Check the bed is clear.
        </p>
        <div className="mt-3 space-y-1.5">
          {targets.map((target) => (
            <Button
              key={target.id}
              size="sm"
              variant={target.busy ? 'secondary' : 'primary'}
              disabled={pending || target.busy}
              className="w-full justify-start"
              onClick={() => send(target)}
            >
              <Send />
              {target.busy ? `${target.name} (busy)` : `Start on ${target.name}`}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
