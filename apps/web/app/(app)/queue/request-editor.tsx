'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import * as Dialog from '@radix-ui/react-dialog'
import { Loader2, Pencil, X } from 'lucide-react'
import { MAX_QUANTITY, type PrintRequestPriority } from '@pb/core/requests'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { FilamentOption } from '@/lib/filament-options'
import {
  editRequest,
  estimateFor,
  printableFiles,
  setRequestModel,
  type PrintableFile,
} from './actions'
import {
  EstimateInput,
  MaterialPicker,
  estimateText,
  estimateValue,
  materialFrom,
  materialInput,
  suggestionHint,
} from './request-fields'
import type { QueueRow } from './request-row'

/**
 * Everything about a request after it was raised: the wording, how many, how
 * urgent, the material and colour, which file to print and how long it takes.
 *
 * The file list is fetched on open — most rows are never edited — and choosing
 * a sliced plate offers its own print time, replacing the estimate only if it
 * was empty or was itself a suggestion.
 */
export function RequestEditor({
  request,
  filaments,
  pending: rowPending,
}: {
  request: QueueRow
  filaments: FilamentOption[]
  pending: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(request.title)
  const [quantity, setQuantity] = useState(String(request.quantity))
  const [priority, setPriority] = useState<PrintRequestPriority>(request.priority)
  const [dueAt, setDueAt] = useState(request.dueAt?.slice(0, 10) ?? '')
  const [requestedBy, setRequestedBy] = useState(request.requestedBy ?? '')
  const [notes, setNotes] = useState(request.notes ?? '')
  const [material, setMaterial] = useState(() => materialFrom(request))
  const [fileId, setFileId] = useState(request.modelFileId ?? '')
  const [files, setFiles] = useState<PrintableFile[] | null>(null)
  const [estimate, setEstimate] = useState(estimateText(request.estimatedMin))
  const [hint, setHint] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, startSaving] = useTransition()
  /** The last suggestion put in the field, so a later one may replace it. */
  const suggested = useRef<string | null>(null)

  function reset() {
    setTitle(request.title)
    setQuantity(String(request.quantity))
    setPriority(request.priority)
    setDueAt(request.dueAt?.slice(0, 10) ?? '')
    setRequestedBy(request.requestedBy ?? '')
    setNotes(request.notes ?? '')
    setMaterial(materialFrom(request))
    setFileId(request.modelFileId ?? '')
    setEstimate(estimateText(request.estimatedMin))
    setHint(null)
    setError(null)
    suggested.current = null
  }

  useEffect(() => {
    if (!open || !request.modelId || files !== null) return
    let cancelled = false
    void printableFiles(request.modelId).then((result) => {
      if (!cancelled) setFiles(result)
    })
    return () => {
      cancelled = true
    }
  }, [open, request.modelId, files])

  async function suggest(nextFileId: string, current: string) {
    if (!request.modelId) return
    const suggestion = await estimateFor(request.modelId, nextFileId || null)
    if (!suggestion) return
    const replaceable = current.trim() === '' || current === suggested.current
    if (!replaceable) return
    const text = estimateText(suggestion.minutes)
    suggested.current = text
    setEstimate(text)
    setHint(suggestionHint(suggestion.source))
  }

  // A request linked to a model but without an estimate gets one offered.
  useEffect(() => {
    if (open && request.modelId && request.estimatedMin == null) {
      void suggest(request.modelFileId ?? '', '')
    }
    // Only on opening; later changes go through the file picker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function save() {
    setError(null)
    const minutes = estimateValue(estimate)
    if (minutes === undefined) {
      setError('That print time is not one this understands.')
      return
    }

    startSaving(async () => {
      if (request.modelId && fileId !== (request.modelFileId ?? '')) {
        const linked = await setRequestModel(request.id, request.modelId, fileId || null)
        if (!linked.ok) {
          setError(linked.error)
          return
        }
      }

      const result = await editRequest(request.id, {
        title,
        quantity: Number(quantity) || 1,
        priority,
        dueAt: dueAt ? new Date(dueAt) : null,
        requestedBy: requestedBy.trim() || null,
        notes: notes.trim() || null,
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
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && saving) return
        if (next) reset()
        setOpen(next)
      }}
    >
      <Dialog.Trigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={rowPending}
          aria-label={`Edit ${request.title}`}
        >
          <Pencil />
        </Button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xl">
          <div className="mb-4 flex items-start justify-between gap-4">
            <Dialog.Title className="text-base font-semibold">Edit request</Dialog.Title>
            <Dialog.Description className="sr-only">
              Change what was asked for, how many, the material and the print time.
            </Dialog.Description>
            <Dialog.Close asChild>
              <Button variant="ghost" size="sm" aria-label="Close" disabled={saving}>
                <X />
              </Button>
            </Dialog.Close>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-[1fr_6rem] gap-3">
              <Field label="What" htmlFor={`edit-title-${request.id}`}>
                <Input value={title} onChange={(event) => setTitle(event.target.value)} />
              </Field>
              <Field label="How many" htmlFor={`edit-quantity-${request.id}`}>
                <Input
                  type="number"
                  min={1}
                  max={MAX_QUANTITY}
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Requested by" htmlFor={`edit-requester-${request.id}`}>
                <Input
                  value={requestedBy}
                  onChange={(event) => setRequestedBy(event.target.value)}
                  placeholder="Optional"
                />
              </Field>
              <Field label="Priority" htmlFor={`edit-priority-${request.id}`}>
                <Select
                  value={priority}
                  onChange={(event) => setPriority(event.target.value as PrintRequestPriority)}
                >
                  <option value="high">Urgent</option>
                  <option value="normal">Normal</option>
                  <option value="low">Whenever</option>
                </Select>
              </Field>
              <Field label="Needed by" htmlFor={`edit-due-${request.id}`}>
                <Input
                  type="date"
                  value={dueAt}
                  onChange={(event) => setDueAt(event.target.value)}
                />
              </Field>
            </div>

            <MaterialPicker value={material} onChange={setMaterial} options={filaments} />

            {request.modelId && (
              <Field
                label="File to print"
                htmlFor={`edit-file-${request.id}`}
                hint={files === null ? 'Loading files…' : undefined}
              >
                <Select
                  value={fileId}
                  disabled={files === null}
                  onChange={(event) => {
                    setFileId(event.target.value)
                    void suggest(event.target.value, estimate)
                  }}
                >
                  <option value="">Not chosen yet</option>
                  {/* The saved file stays selectable even before the list loads. */}
                  {files === null && request.modelFileId && (
                    <option value={request.modelFileId}>{request.filename}</option>
                  )}
                  {files?.some((file) => file.category === 'slicer') && (
                    <optgroup label="Sliced">
                      {files
                        .filter((file) => file.category === 'slicer')
                        .map((file) => (
                          <option key={file.id} value={file.id}>
                            {file.filename}
                          </option>
                        ))}
                    </optgroup>
                  )}
                  {files?.some((file) => file.category === 'model') && (
                    <optgroup label="Models">
                      {files
                        .filter((file) => file.category === 'model')
                        .map((file) => (
                          <option key={file.id} value={file.id}>
                            {file.filename}
                          </option>
                        ))}
                    </optgroup>
                  )}
                </Select>
              </Field>
            )}

            <EstimateInput
              id={`edit-estimate-${request.id}`}
              value={estimate}
              onChange={(value) => {
                setEstimate(value)
                if (value !== suggested.current) setHint(null)
              }}
              hint={hint}
              quantity={Number(quantity) || 1}
            />

            <Field label="Notes" htmlFor={`edit-notes-${request.id}`}>
              <Textarea
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Infill, supports, who to hand it to…"
              />
            </Field>

            {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

            <div className="flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button variant="ghost" disabled={saving}>
                  Cancel
                </Button>
              </Dialog.Close>
              <Button disabled={saving || title.trim().length === 0} onClick={save}>
                {saving && <Loader2 className="animate-spin" />}
                Save
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
