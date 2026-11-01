'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Check, ClipboardList, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { Select } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { FilamentOption } from '@/lib/filament-options'
import { addModelToQueue, estimateFor } from '../../queue/actions'
import {
  EstimateInput,
  MaterialPicker,
  NO_MATERIAL,
  estimateText,
  estimateValue,
  materialInput,
  suggestionHint,
} from '../../queue/request-fields'

/**
 * Queues this model from its own page.
 *
 * The reverse of the queue's link picker, and the direction people actually
 * travel most: you are already looking at the thing when you decide it needs
 * printing, and going to another page to retype its name is how a queue stops
 * being used.
 *
 * Being on the model page is also when the details are at hand: which plate,
 * in what, and — from the plate's G-code or earlier prints — roughly how long.
 */
export function QueueButton({
  modelId,
  modelPublicId,
  modelName,
  openCount,
  files,
  filaments,
}: {
  modelId: string
  modelPublicId: string
  modelName: string
  /** Requests already open against this model. */
  openCount: number
  /** Printable files: sliced plates and meshes. */
  files: { id: string; filename: string; category: 'model' | 'slicer' }[]
  filaments: FilamentOption[]
}) {
  const router = useRouter()
  const sliced = files.filter((file) => file.category === 'slicer')
  const meshes = files.filter((file) => file.category === 'model')
  // The only sliced plate is almost certainly the one to print.
  const defaultFile = sliced.length === 1 ? sliced[0]!.id : ''

  const [open, setOpen] = useState(false)
  const [requestedBy, setRequestedBy] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [fileId, setFileId] = useState(defaultFile)
  const [material, setMaterial] = useState(NO_MATERIAL)
  const [pickerKey, setPickerKey] = useState(0)
  const [notes, setNotes] = useState('')
  const [estimate, setEstimate] = useState('')
  const [hint, setHint] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  /** The last suggestion put in the field, so a later one may replace it. */
  const suggested = useRef<string | null>(null)

  async function suggest(nextFileId: string, current: string) {
    const suggestion = await estimateFor(modelId, nextFileId || null)
    // Never over something typed in; only over blank or an earlier suggestion.
    if (current.trim() !== '' && current !== suggested.current) return
    const text = suggestion ? estimateText(suggestion.minutes) : ''
    suggested.current = text
    setEstimate(text)
    setHint(suggestion ? suggestionHint(suggestion.source) : null)
  }

  function reset() {
    setRequestedBy('')
    setQuantity('1')
    setFileId(defaultFile)
    setMaterial(NO_MATERIAL)
    setPickerKey((key) => key + 1)
    setNotes('')
    setEstimate('')
    setHint(null)
    setError(null)
    suggested.current = null
  }

  function submit() {
    setError(null)
    const minutes = estimateValue(estimate)
    if (minutes === undefined) {
      setError('That print time is not one this understands.')
      return
    }

    startTransition(async () => {
      const result = await addModelToQueue({
        modelId,
        modelPublicId,
        title: modelName,
        quantity: Number(quantity) || 1,
        requestedBy,
        notes: notes.trim() || null,
        modelFileId: fileId || null,
        ...materialInput(material),
        estimatedMin: minutes,
      })

      if (!result.ok) {
        setError(result.error)
        return
      }

      setOpen(false)
      router.refresh()
    })
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          reset()
          void suggest(defaultFile, '')
        }
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={
            openCount > 0
              ? `Print queue: ${openCount} open for this model`
              : 'Add this model to the print queue'
          }
        >
          <ClipboardList />
          <span className="hidden sm:inline">
            {/* The count is the useful part when there is one: it says someone
                is already waiting, which changes whether you add another. */}
            {openCount > 0 ? `Queued (${openCount})` : 'Queue'}
          </span>
        </Button>
      </PopoverTrigger>

      <PopoverContent className="max-h-[80vh] w-[min(26rem,calc(100vw-2rem))] overflow-y-auto p-3">
        <div className="space-y-3">
          <p className="text-sm font-medium">Add to the print queue</p>

          {openCount > 0 && (
            <p className="text-xs text-[var(--color-ink-muted)]">
              {openCount === 1 ? 'One request is' : `${openCount} requests are`} already open for
              this model.{' '}
              <Link href="/queue" className="text-[var(--color-accent)] hover:underline">
                See the queue
              </Link>
            </p>
          )}

          <div className="grid grid-cols-[1fr_5rem] gap-2">
            <Field label="Requested by" htmlFor="queue-model-requester">
              <Input
                autoFocus
                value={requestedBy}
                onChange={(event) => setRequestedBy(event.target.value)}
                placeholder="Optional"
                className="h-9"
              />
            </Field>

            <Field label="How many" htmlFor="queue-model-quantity">
              <Input
                type="number"
                min={1}
                max={999}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                className="h-9"
              />
            </Field>
          </div>

          {files.length > 1 && (
            <Field label="File to print" htmlFor="queue-model-file">
              <Select
                value={fileId}
                onChange={(event) => {
                  setFileId(event.target.value)
                  void suggest(event.target.value, estimate)
                }}
              >
                <option value="">Not chosen yet</option>
                {sliced.length > 0 && (
                  <optgroup label="Sliced">
                    {sliced.map((file) => (
                      <option key={file.id} value={file.id}>
                        {file.filename}
                      </option>
                    ))}
                  </optgroup>
                )}
                {meshes.length > 0 && (
                  <optgroup label="Models">
                    {meshes.map((file) => (
                      <option key={file.id} value={file.id}>
                        {file.filename}
                      </option>
                    ))}
                  </optgroup>
                )}
              </Select>
            </Field>
          )}

          <MaterialPicker
            key={pickerKey}
            value={material}
            onChange={setMaterial}
            options={filaments}
          />

          <EstimateInput
            id="queue-model-estimate"
            value={estimate}
            onChange={(value) => {
              setEstimate(value)
              if (value !== suggested.current) setHint(null)
            }}
            hint={hint}
            quantity={Number(quantity) || 1}
          />

          <Field label="Notes" htmlFor="queue-model-notes">
            <textarea
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional"
              className="w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] transition-colors focus:border-[var(--color-accent)]"
            />
          </Field>

          {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}

          <Button size="sm" disabled={pending} onClick={submit} className="w-full">
            {pending ? <Loader2 className="animate-spin" /> : <Check />}
            Add to queue
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
