'use client'

import { useState } from 'react'
import { Loader2, Play } from 'lucide-react'
import type { SlotAssignment } from '@pb/core'
import { Button } from '@/components/ui/button'
import { Swatch as SharedSwatch } from '@/components/ui/swatch'
import type { SlotChoice } from './send-actions'

/**
 * Which ACE slot each colour of the file prints from, when PrintBench could
 * not tell on its own — asked here rather than in KX-Bridge's page.
 *
 * Opens on the best guess, so the usual answer is one click.
 */
export function SlotChooser({
  choice,
  pending,
  onStart,
  onCancel,
}: {
  choice: SlotChoice
  pending: boolean
  onStart: (slots: SlotAssignment[]) => void
  onCancel: () => void
}) {
  const [picked, setPicked] = useState<Record<number, number | null>>(() =>
    Object.fromEntries(choice.paints.map((paint) => [paint.paint, paint.slot])),
  )
  const several = choice.paints.length > 1
  const complete = choice.paints.every((paint) => picked[paint.paint] != null)

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">Print from which slot?</p>
        <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
          {choice.printerName} has more than one filament that could be meant.
        </p>
      </div>

      {choice.paints.map((paint) => (
        <fieldset key={paint.paint} className="space-y-1.5">
          {(several || paint.material) && (
            <legend className="mb-1.5 flex items-center gap-1.5 text-xs text-[var(--color-ink-muted)]">
              {paint.colorHex && <Swatch hex={paint.colorHex} />}
              {several ? `Colour ${paint.paint + 1}` : 'Sliced for'}
              {paint.material && ` · ${paint.material}`}
            </legend>
          )}
          <div className="grid grid-cols-2 gap-1.5">
            {choice.slots.map((slot) => {
              const selected = picked[paint.paint] === slot.index
              return (
                <button
                  key={slot.index}
                  type="button"
                  aria-pressed={selected}
                  disabled={pending}
                  onClick={() => setPicked((now) => ({ ...now, [paint.paint]: slot.index }))}
                  className={`flex items-center gap-2 rounded-[var(--radius-control)] border px-2 py-1.5 text-left text-xs disabled:opacity-50 ${
                    selected
                      ? 'border-[var(--color-accent)] bg-[var(--color-surface-2)]'
                      : 'border-[var(--color-border)] hover:bg-[var(--color-surface-2)]'
                  }`}
                >
                  <Swatch hex={slot.colorHex} />
                  <span className="min-w-0">
                    <span className="block font-medium">Slot {slot.index + 1}</span>
                    <span className="block truncate text-[var(--color-ink-muted)]">
                      {slot.name ?? slot.material ?? 'Loaded'}
                      {slot.spoolmanSpoolId != null && ` · #${slot.spoolmanSpoolId}`}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </fieldset>
      ))}

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={pending || !complete}
          onClick={() =>
            onStart(
              choice.paints.map((paint) => ({ paint: paint.paint, slot: picked[paint.paint]! })),
            )
          }
        >
          {pending ? <Loader2 className="animate-spin" /> : <Play />}
          Start
        </Button>
      </div>
    </div>
  )
}

function Swatch({ hex }: { hex?: string }) {
  return <SharedSwatch color={hex} className="size-3.5" />
}
