'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { SlotAssignment } from '@pb/core'
import type { SlotChoice } from '../models/[publicId]/send-actions'
import { SlotChooser } from '../models/[publicId]/slot-chooser'
import { sendRequestToPrinter } from './actions'
import type { SendTarget } from './request-row'

/**
 * Sends the request's sliced file to a printer and starts it, from the queue
 * row, so working the queue does not mean a trip to the model page.
 *
 * Always a confirming step — it starts a printer — and the printer list says
 * which ones were busy at the worker's last look; the server asks the printer
 * again before sending. A KX-Bridge printer that cannot tell which slot to
 * print from asks here, with its best guess picked.
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
  const [choosing, setChoosing] = useState<{ target: SendTarget; choice: SlotChoice } | null>(null)

  function send(target: SendTarget, slots?: SlotAssignment[]) {
    onError(null)
    setMessage(null)
    startTransition(async () => {
      const result = await sendRequestToPrinter(requestId, target.id, slots)
      if (!result.ok) {
        if (result.choose) {
          setChoosing({ target, choice: result.choose })
          return
        }
        onError(result.error)
        setChoosing(null)
        setOpen(false)
        return
      }
      setMessage(result.message)
      setChoosing(null)
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setChoosing(null)
      }}
    >
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
      <PopoverContent className={choosing ? 'w-80 p-3' : 'w-72 p-3'}>
        {choosing ? (
          <SlotChooser
            choice={choosing.choice}
            pending={pending}
            onStart={(slots) => send(choosing.target, slots)}
            onCancel={() => setChoosing(null)}
          />
        ) : (
          <>
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
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
