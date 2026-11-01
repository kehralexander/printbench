'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FolderPlus, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ClockTime } from '@/components/ui/clock-time'
import { PRINT_OUTCOME } from '@/lib/print-outcome'
import { LinkPicker } from '../../queue/link-picker'
import { addJobFileToModel, dismissPrinterJob, linkPrinterJob } from './actions'

export interface JobLine {
  id: string
  printerName: string
  filename: string
  status: 'success' | 'cancelled' | 'failed'
  percent: number | null
  duration: string | null
  /** ISO. */
  startedAt: string
  /** The printer can hand the file back (Moonraker, OctoPrint). */
  fetchable: boolean
}

/** One printer job the library did not know, and what can be done about it. */
export function JobRow({
  job,
  canLink,
  canAdd,
}: {
  job: JobLine
  canLink: boolean
  canAdd: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const name = job.filename.split('/').pop() ?? job.filename
  const outcome = PRINT_OUTCOME[job.status]
  const suggest = name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ')

  function run(work: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>) {
    setError(null)
    startTransition(async () => {
      const result = await work()
      if (!result.ok) {
        setError(result.error)
        return
      }
      setMessage(result.message ?? null)
      router.refresh()
    })
  }

  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1 basis-64">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium" title={job.filename}>
            {name}
          </span>
          <Badge tone={outcome.tone}>
            {outcome.label}
            {job.status !== 'success' && job.percent != null && ` at ${job.percent}%`}
          </Badge>
        </div>
        <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
          {job.printerName} · <ClockTime value={job.startedAt} />
          {job.duration && ` · ${job.duration}`}
        </p>
        {message && <p className="mt-1 text-xs text-[var(--color-success)]">{message}</p>}
        {error && <p className="mt-1 text-xs text-[var(--color-danger)]">{error}</p>}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1">
        {canLink && (
          <LinkPicker
            linkedName={null}
            suggestQuery={suggest}
            pending={pending}
            label="Link to a model"
            hint="Adds this print, and any other of the same file, to the model's print history."
            onLink={(modelId) => {
              if (modelId) run(() => linkPrinterJob(job.id, modelId))
            }}
          />
        )}
        {canLink && canAdd && job.fetchable && (
          <LinkPicker
            linkedName={null}
            suggestQuery={suggest}
            pending={pending}
            label="Add file to a model"
            icon={FolderPlus}
            hint={`Fetches ${name} from the printer into the model's folder, and adds this print to its history.`}
            onLink={(modelId) => {
              if (modelId) run(() => addJobFileToModel(job.id, modelId))
            }}
          />
        )}
        {canLink && (
          <Button
            variant="ghost"
            size="icon"
            disabled={pending}
            aria-label={`Dismiss ${name}`}
            title="Not worth keeping: hide it from this list"
            onClick={() => run(() => dismissPrinterJob(job.id))}
          >
            <X />
          </Button>
        )}
      </div>
    </li>
  )
}
