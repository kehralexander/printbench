'use client'

import { useMemo, useState, useTransition } from 'react'
import { AlertTriangle, Check, Loader2, RefreshCw, X } from 'lucide-react'
import type { FilamentSlot, StepOutcome } from '@pb/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Swatch } from '@/components/ui/swatch'
import { cn } from '@/lib/cn'
import {
  changeSlotSpool,
  loadSpoolChoices,
  type SpoolChoices,
  type SpoolOption,
} from '@/app/(app)/printers/actions'

/** A KX-Bridge printer a spool can be loaded into, with what it has loaded. */
export interface LoadTarget {
  hostId: string
  printerName: string
  slots: FilamentSlot[]
}

/** "Empty" in the picker: the slot is left without a spool. */
const NONE = 'none'

/**
 * Swapping the spool in one slot: pick what goes in, say where the one coming
 * out goes, and watch each system take it — printer, bridge, Spoolman.
 *
 * Opened from a slot, it asks for the spool; opened from a spool (the queue's
 * "not loaded", a spool in the inventory), it asks for the slot first and
 * comes with that spool picked.
 */
export function ChangeSpool({
  hostId,
  slotIndex,
  slots = [],
  spoolId,
  printerName,
  label = 'Change',
  className,
}: {
  hostId: string
  /** The slot to change; omit to ask, from `slots`. */
  slotIndex?: number
  /** What the printer has loaded, to choose a slot from. */
  slots?: FilamentSlot[]
  /** The spool to put in, picked when the dialog opens. */
  spoolId?: number
  printerName: string
  label?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [slot, setSlot] = useState<number | null>(slotIndex ?? null)
  const [choices, setChoices] = useState<SpoolChoices | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<number | typeof NONE | null>(null)
  const [shelf, setShelf] = useState('')
  const [query, setQuery] = useState('')
  const [steps, setSteps] = useState<StepOutcome[] | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const reset = () => {
    setSlot(slotIndex ?? null)
    setChoices(null)
    setError(null)
    setPicked(null)
    setQuery('')
    setSteps(null)
    setDone(null)
  }

  const load = (index: number) =>
    startTransition(async () => {
      setSlot(index)
      const result = await loadSpoolChoices(hostId, index)
      if (!result.ok) return setError(result.error)
      setChoices(result.choices)
      setShelf(result.choices.returnLocation)
      if (spoolId != null && result.choices.spools.some((spool) => spool.id === spoolId)) {
        setPicked(spoolId)
      }
    })

  const submit = () =>
    startTransition(async () => {
      setError(null)
      setDone(null)
      if (slot == null) return
      const result = await changeSlotSpool(
        hostId,
        slot,
        picked === NONE ? null : (picked as number),
        shelf,
      )
      setSteps(result.steps ?? null)
      if (result.ok) setDone(result.message)
      else setError(result.error)
    })

  const shown = useMemo(() => {
    if (!choices) return []
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return choices.spools.filter((spool) => {
      const text = `${spool.label} #${spool.id} ${spool.location ?? ''}`.toLowerCase()
      return words.every((word) => text.includes(word))
    })
  }, [choices, query])

  const chosen =
    picked == null || picked === NONE ? null : choices?.spools.find((s) => s.id === picked)
  const finished = steps != null && done != null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        setOpen(next)
        if (next) {
          reset()
          if (slotIndex != null) load(slotIndex)
        }
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn('text-[var(--color-accent)] hover:underline', className)}
          aria-label={
            slotIndex != null
              ? `Change the spool in slot ${slotIndex + 1}`
              : spoolId != null
                ? `Load spool #${spoolId} into ${printerName}`
                : undefined
          }
        >
          {label}
        </button>
      </DialogTrigger>
      <DialogContent
        title={
          slot != null
            ? `Change spool · slot ${slot + 1}`
            : spoolId != null
              ? `Load spool #${spoolId}`
              : 'Change spool'
        }
        description={`${printerName}, its KX-Bridge and Spoolman are all updated.`}
        hideClose={pending}
      >
        {slot == null && (
          <div className="space-y-2">
            <p className="text-sm">Into which slot?</p>
            <ul className="grid grid-cols-2 gap-1.5">
              {slots.map((candidate) => (
                <li key={candidate.index}>
                  <button
                    type="button"
                    onClick={() => load(candidate.index)}
                    className="flex w-full items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-border)] px-2 py-1.5 text-left text-sm hover:bg-[var(--color-surface-2)]"
                  >
                    <Swatch
                      color={candidate.loaded ? candidate.colorHex : null}
                      className="size-4"
                    />
                    <span className="min-w-0">
                      <span className="block font-medium">Slot {candidate.index + 1}</span>
                      <span className="block truncate text-xs text-[var(--color-ink-muted)]">
                        {!candidate.loaded
                          ? 'Empty'
                          : [
                              candidate.material,
                              candidate.spoolmanSpoolId != null && `#${candidate.spoolmanSpoolId}`,
                            ]
                              .filter(Boolean)
                              .join(' · ') || 'Loaded'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {slot != null && !choices && !error && (
          <p className="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
            <Loader2 className="size-4 animate-spin" /> Reading the slot and Spoolman…
          </p>
        )}

        {choices && steps == null && (
          <div className="space-y-4">
            <div className="text-sm">
              <p className="mb-1 text-xs text-[var(--color-ink-muted)]">Now</p>
              {choices.current ? (
                <SpoolLine spool={choices.current} printerName={printerName} />
              ) : (
                <p className="text-[var(--color-ink-muted)]">No spool bound</p>
              )}
            </div>

            <div className="space-y-2">
              <Field label="Goes in" htmlFor="spool-search">
                <Input
                  placeholder="Search spools"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  disabled={pending}
                />
              </Field>
              <ul
                className="max-h-72 space-y-1 overflow-y-auto"
                role="radiogroup"
                aria-label="Spool"
              >
                {!query && (
                  <Choice selected={picked === NONE} onPick={() => setPicked(NONE)}>
                    <Swatch color={null} className="size-4" />
                    <span className="text-[var(--color-ink-muted)]">No spool — leave it empty</span>
                  </Choice>
                )}
                {shown.map((spool) => (
                  <Choice
                    key={spool.id}
                    selected={picked === spool.id}
                    onPick={() => setPicked(spool.id)}
                  >
                    <SpoolLine spool={spool} printerName={printerName} />
                  </Choice>
                ))}
                {shown.length === 0 && query && (
                  <li className="px-2 py-1.5 text-sm text-[var(--color-ink-muted)]">
                    No spool matches.
                  </li>
                )}
              </ul>
            </div>

            {chosen?.inSlot != null && (
              <p className="text-xs text-[var(--color-ink-muted)]">
                Spool #{chosen.id} is bound to slot {chosen.inSlot + 1}; that slot is unbound.
              </p>
            )}

            {choices.current && (
              <Field label={`Spool #${choices.current.id} goes to`} htmlFor="spool-shelf">
                <Select
                  value={shelf}
                  onChange={(event) => setShelf(event.target.value)}
                  disabled={pending}
                >
                  {choices.locations.map((location) => (
                    <option key={location} value={location}>
                      {location}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={pending || picked == null}>
                {pending && <Loader2 className="animate-spin" />}
                Change spool
              </Button>
            </div>
          </div>
        )}

        {steps != null && (
          <div className="space-y-4">
            <ul className="space-y-1.5 text-sm">
              {steps.map((step) => (
                <li key={step.key} className="flex gap-2">
                  <StepIcon status={step.status} />
                  <span className="min-w-0">
                    <span
                      className={step.status === 'skipped' ? 'text-[var(--color-ink-muted)]' : ''}
                    >
                      {step.label}
                    </span>
                    {step.detail && (
                      <span className="block text-xs text-[var(--color-ink-muted)]">
                        {step.detail}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {done && <p className="text-sm">{done}</p>}
            <div className="flex justify-end gap-2">
              {!finished && (
                <Button variant="secondary" onClick={submit} disabled={pending}>
                  {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  Retry
                </Button>
              )}
              <Button onClick={() => setOpen(false)} disabled={pending}>
                {finished ? 'Done' : 'Close'}
              </Button>
            </div>
          </div>
        )}

        {error && (
          <p className="mt-3 text-sm text-[var(--color-danger)]" role="alert">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Choice({
  selected,
  onPick,
  children,
}: {
  selected: boolean
  onPick: () => void
  children: React.ReactNode
}) {
  return (
    <li>
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={onPick}
        className={cn(
          'flex w-full items-center gap-2 rounded-[var(--radius-control)] border px-2 py-1.5 text-left text-sm',
          selected
            ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
            : 'border-transparent hover:bg-[var(--color-surface-2)]',
        )}
      >
        {children}
      </button>
    </li>
  )
}

function SpoolLine({ spool, printerName }: { spool: SpoolOption; printerName: string }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <Swatch color={spool.colorHex} className="size-4" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">
          {spool.label} <span className="text-[var(--color-ink-muted)]">#{spool.id}</span>
        </span>
        <span className="block truncate text-xs text-[var(--color-ink-muted)]">
          {[
            spool.remainingG != null ? `${Math.round(spool.remainingG)} g left` : null,
            spool.inSlot != null
              ? `slot ${spool.inSlot + 1}`
              : spool.location === printerName
                ? `${printerName}, no slot`
                : spool.location,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </span>
      {spool.wantedBy > 0 && (
        <Badge tone="accent">{spool.wantedBy === 1 ? 'Queue' : `Queue ×${spool.wantedBy}`}</Badge>
      )}
    </span>
  )
}

function StepIcon({ status }: { status: StepOutcome['status'] }) {
  switch (status) {
    case 'done':
      return <Check className="mt-0.5 size-4 shrink-0 text-[var(--color-success)]" />
    case 'failed':
      return <X className="mt-0.5 size-4 shrink-0 text-[var(--color-danger)]" />
    case 'unconfirmed':
      return <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--color-warning)]" />
    case 'skipped':
      return (
        <span className="mt-0.5 size-4 shrink-0 text-center text-[var(--color-ink-faint)]">–</span>
      )
  }
}
