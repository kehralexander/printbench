'use client'

import { useMemo, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus } from 'lucide-react'
import { MAX_BULK_REQUESTS, parseRequestLines, type PrintRequestPriority } from '@pb/core/requests'
import { PageHeader } from '@/components/shell/page-header'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Callout } from '@/components/ui/callout'
import type { FilamentOption } from '@/lib/filament-options'
import { addRequests } from './actions'
import { MaterialPicker, NO_MATERIAL, materialInput } from './request-fields'

/**
 * Adding a batch.
 *
 * Requests arrive as a message — "the dragon, two cable clips and something to
 * hold the kitchen roll" — so the box takes the message. One line becomes one
 * request, and everything alongside it (who asked, when they need it) is set
 * once for the whole batch rather than repeated per row.
 *
 * The preview underneath is the important part: line parsing has rules, and
 * rules the user cannot see are rules they cannot trust. Showing the split
 * before it is saved turns "x4" from a guess into something they watched work.
 */
/**
 * The queue's page header and its "Add requests" panel. They share the open
 * state, so the button can sit in the header like every other page's primary
 * action while the form opens just below it.
 */
export function AddRequests({
  title,
  description,
  requesterSuggestions,
  filaments,
}: {
  title: string
  description: ReactNode
  requesterSuggestions: string[]
  filaments: FilamentOption[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [requestedBy, setRequestedBy] = useState('')
  const [priority, setPriority] = useState<PrintRequestPriority>('normal')
  const [dueAt, setDueAt] = useState('')
  const [notes, setNotes] = useState('')
  const [material, setMaterial] = useState(NO_MATERIAL)
  /** Remounts the picker after a submit, so it shows the cleared value. */
  const [pickerKey, setPickerKey] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // The same parser the server will use, so the preview cannot disagree with
  // what gets saved.
  const parsed = useMemo(() => parseRequestLines(text), [text])

  function submit() {
    setError(null)
    setNotice(null)

    startTransition(async () => {
      const result = await addRequests({
        text,
        requestedBy,
        priority,
        dueAt: dueAt || null,
        notes: notes.trim() || null,
        ...materialInput(material),
      })

      if (!result.ok) {
        setError(result.error)
        return
      }

      setNotice(summarise(result.created, result.autoLinked, result.skipped))
      setText('')
      setDueAt('')
      setNotes('')
      setMaterial(NO_MATERIAL)
      setPickerKey((key) => key + 1)
      // The requester is kept: a batch is usually the start of a conversation
      // with one person, not the end of it.
      router.refresh()
    })
  }

  const header = (
    <PageHeader
      title={title}
      description={description}
      actions={
        <Button onClick={() => setOpen(true)}>
          <Plus />
          Add requests
        </Button>
      }
    />
  )

  function close() {
    setOpen(false)
    setError(null)
    setNotice(null)
  }

  return (
    <>
      {header}
      {/* A dialog like every other form; it stays open after adding, for the next batch. */}
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent
          title="Add to the queue"
          description="One thing per line. Add a count with “x4” at either end, and anything whose name matches a model exactly is linked to it automatically."
          size="lg"
        >
          <div className="space-y-4">
            <Field label="What needs printing" htmlFor="queue-lines">
              <Textarea
                id="queue-lines"
                autoFocus
                rows={5}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={
                  'Articulated dragon\nCable clip x4\nSomething to hold the kitchen roll'
                }
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Requested by" htmlFor="queue-requester" hint="Optional">
                <>
                  <Input
                    id="queue-requester"
                    list="queue-requester-options"
                    value={requestedBy}
                    onChange={(event) => setRequestedBy(event.target.value)}
                    placeholder="Whoever asked"
                  />
                  {/* Names already in the queue, so the third request from the
                  same person is a pick rather than a retype. */}
                  <datalist id="queue-requester-options">
                    {requesterSuggestions.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </>
              </Field>

              <Field label="Priority" htmlFor="queue-priority">
                <Select
                  id="queue-priority"
                  value={priority}
                  onChange={(event) => setPriority(event.target.value as PrintRequestPriority)}
                >
                  <option value="high">Urgent</option>
                  <option value="normal">Normal</option>
                  <option value="low">Whenever</option>
                </Select>
              </Field>

              <Field label="Needed by" htmlFor="queue-due" hint="Optional">
                <Input
                  id="queue-due"
                  type="date"
                  value={dueAt}
                  onChange={(event) => setDueAt(event.target.value)}
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <MaterialPicker
                key={pickerKey}
                value={material}
                onChange={setMaterial}
                options={filaments}
              />
              <Field label="Notes" htmlFor="queue-notes" hint="Optional, for every line above">
                <Textarea
                  rows={2}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Infill, supports, who to hand it to…"
                />
              </Field>
            </div>

            {parsed.length > 0 && (
              <Callout
                title={
                  <>
                    {parsed.length} request{parsed.length === 1 ? '' : 's'} will be added
                    {parsed.length === MAX_BULK_REQUESTS && ' (the most that can go in at once)'}
                  </>
                }
              >
                <ul className="space-y-0.5">
                  {parsed.map((line, index) => (
                    <li key={index} className="truncate text-xs text-[var(--color-ink)]">
                      {line.title}
                      {line.quantity > 1 && (
                        <span className="text-[var(--color-ink-faint)]"> × {line.quantity}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </Callout>
            )}

            {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
            {notice && <p className="text-sm text-[var(--color-success)]">{notice}</p>}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={close}>
                Close
              </Button>
              <Button disabled={pending || parsed.length === 0} onClick={submit}>
                {pending ? <Loader2 className="animate-spin" /> : <Plus />}
                Add {parsed.length > 0 ? parsed.length : ''} to queue
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function summarise(created: number, autoLinked: number, skipped: string[]): string {
  const parts = [`Added ${created} request${created === 1 ? '' : 's'}`]
  if (autoLinked > 0) parts.push(`${autoLinked} linked to your library`)
  if (skipped.length > 0) parts.push(`${skipped.length} could not be added`)
  return `${parts.join(' · ')}.`
}
