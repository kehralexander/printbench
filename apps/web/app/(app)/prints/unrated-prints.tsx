'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Camera, Check, Loader2, Star, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { ClockTime } from '@/components/ui/clock-time'
import { SectionHeader } from '@/components/ui/section-header'
import { cn } from '@/lib/cn'
import { PRINT_OUTCOME } from '@/lib/print-outcome'
import { ratePrint, skipReview } from './review-actions'

export interface UnratedLine {
  id: string
  modelName: string
  modelPublicId: string
  printerName: string | null
  status: 'success' | 'failed' | 'partial' | 'in_progress'
  notes: string | null
  /** ISO. */
  finishedAt: string | null
  hasPhoto: boolean
}

/**
 * "How did it go?" for prints the printer logged on its own: one click on a
 * star rates it; a note, a photo, or "it failed after all" are optional.
 */
export function UnratedPrints({ prints }: { prints: UnratedLine[] }) {
  if (prints.length === 0) return null
  return (
    <section className="mb-8">
      <SectionHeader title="How did it go?" />
      <Card className="overflow-hidden">
        <ul className="divide-y divide-[var(--color-border)]">
          {prints.map((print) => (
            <UnratedRow key={print.id} print={print} />
          ))}
        </ul>
      </Card>
    </section>
  )
}

function UnratedRow({ print }: { print: UnratedLine }) {
  const router = useRouter()
  const [hover, setHover] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [failed, setFailed] = useState(false)
  const [photo, setPhoto] = useState<'none' | 'uploading' | 'done'>(
    print.hasPhoto ? 'done' : 'none',
  )
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const fileInput = useRef<HTMLInputElement>(null)

  function save(stars: number) {
    setError(null)
    startTransition(async () => {
      const result = await ratePrint(print.id, { rating: stars, note, failed })
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  async function upload(file: File) {
    setError(null)
    setPhoto('uploading')
    const body = new FormData()
    body.set('photo', file)
    const response = await fetch(`/api/prints/${print.id}/photo`, { method: 'POST', body })
    const result = (await response.json().catch(() => null)) as
      { ok: true } | { ok: false; error: string } | null
    if (!result?.ok) {
      setPhoto(print.hasPhoto ? 'done' : 'none')
      setError(result && !result.ok ? result.error : 'Could not upload that photo.')
      return
    }
    setPhoto('done')
  }

  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <Link href={`/models/${print.modelPublicId}`} className="font-medium hover:underline">
          {print.modelName}
        </Link>
        <Badge tone={PRINT_OUTCOME[print.status].tone}>{PRINT_OUTCOME[print.status].label}</Badge>
        <span className="text-xs text-[var(--color-ink-muted)]">
          {print.printerName && `on ${print.printerName} `}
          {print.finishedAt && <ClockTime value={print.finishedAt} />}
          {print.status !== 'success' && print.notes && ` · ${print.notes}`}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex" role="group" aria-label={`Rate ${print.modelName}`}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              disabled={pending}
              aria-label={`${n} star${n === 1 ? '' : 's'}`}
              className="p-0.5 text-[var(--color-ink-faint)] hover:text-[var(--color-accent)]"
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(n)}
              onBlur={() => setHover(null)}
              onClick={() => save(n)}
            >
              <Star
                className={cn(
                  'size-5',
                  hover != null &&
                    n <= hover &&
                    'fill-[var(--color-accent)] text-[var(--color-accent)]',
                )}
              />
            </button>
          ))}
        </div>

        <Input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Anything worth remembering? (optional)"
          className="h-8 min-w-48 flex-1 text-sm"
          disabled={pending}
        />

        {print.status === 'success' && (
          <label className="flex items-center gap-1.5 text-xs text-[var(--color-ink-muted)]">
            <Checkbox
              checked={failed}
              onChange={(event) => setFailed(event.target.checked)}
              disabled={pending}
            />
            It failed after all
          </label>
        )}

        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void upload(file)
            event.target.value = ''
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          disabled={pending || photo === 'uploading'}
          onClick={() => fileInput.current?.click()}
        >
          {photo === 'uploading' ? (
            <Loader2 className="animate-spin" />
          ) : photo === 'done' ? (
            <Check />
          ) : (
            <Camera />
          )}
          {photo === 'done' ? 'Photo added' : 'Photo'}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          disabled={pending}
          aria-label={`Do not rate ${print.modelName}`}
          title="Skip: stop asking about this one"
          onClick={() =>
            startTransition(async () => {
              const result = await skipReview(print.id)
              if (!result.ok) setError(result.error)
              else router.refresh()
            })
          }
        >
          <X />
        </Button>
      </div>
      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
    </li>
  )
}
