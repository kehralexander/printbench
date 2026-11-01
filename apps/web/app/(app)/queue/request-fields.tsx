'use client'

import { useId, useState } from 'react'
import { X } from 'lucide-react'
import { formatEstimate, parseEstimate } from '@pb/core/requests'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import type { FilamentOption } from '@/lib/filament-options'

/**
 * Form pieces shared by every place a request is written: the bulk box, the
 * model page's "Queue" and the edit dialog on a queue row.
 */

export interface MaterialValue {
  material: string
  colorName: string
  /** Lowercase "#rrggbb", or empty for "any colour". */
  colorHex: string
  /** The Spoolman spool picked, when the choice was one. */
  spoolmanSpoolId: number | null
}

export const NO_MATERIAL: MaterialValue = {
  material: '',
  colorName: '',
  colorHex: '',
  spoolmanSpoolId: null,
}

export function materialFrom(request: {
  material: string | null
  colorName: string | null
  colorHex: string | null
  spoolmanSpoolId?: number | null
}): MaterialValue {
  return {
    material: request.material ?? '',
    colorName: request.colorName ?? '',
    colorHex: request.colorHex ?? '',
    spoolmanSpoolId: request.spoolmanSpoolId ?? null,
  }
}

/** The shape the server actions take: blanks become nulls. */
export function materialInput(value: MaterialValue) {
  return {
    material: value.material.trim() || null,
    colorName: value.colorName.trim() || null,
    colorHex: value.colorHex || null,
    spoolmanSpoolId: value.spoolmanSpoolId,
  }
}

const CUSTOM = '__custom'

function matchOption(value: MaterialValue, options: FilamentOption[]): string {
  if (!value.material && !value.colorName && !value.colorHex && !value.spoolmanSpoolId) return ''
  if (value.spoolmanSpoolId != null) {
    const spool = options.find((option) => option.spoolmanSpoolId === value.spoolmanSpoolId)
    if (spool) return spool.id
  }
  const match = options.find(
    (option) =>
      option.material.toLowerCase() === value.material.trim().toLowerCase() &&
      (option.colorName ?? '').toLowerCase() === value.colorName.trim().toLowerCase() &&
      (option.colorHex ?? '') === value.colorHex,
  )
  return match?.id ?? CUSTOM
}

/**
 * Material and colour: one of the filaments on hand, or anything typed in.
 *
 * The inventory comes first because "in the red PLA" usually means a spool
 * that exists. "Other…" covers the rest — a colour you would have to buy, or a
 * request written before the inventory was.
 */
export function MaterialPicker({
  value,
  onChange,
  options,
}: {
  value: MaterialValue
  onChange: (value: MaterialValue) => void
  options: FilamentOption[]
}) {
  const id = useId()
  const [mode, setMode] = useState(() => matchOption(value, options))
  const materials = [...new Set(options.map((option) => option.material))]

  return (
    <div className="space-y-2">
      <label htmlFor={`${id}-filament`} className="block text-sm font-medium">
        Material and colour
      </label>
      <Select
        id={`${id}-filament`}
        value={mode}
        onChange={(event) => {
          const next = event.target.value
          setMode(next)
          if (next === '') onChange(NO_MATERIAL)
          const option = options.find((candidate) => candidate.id === next)
          if (option) {
            onChange({
              material: option.material,
              colorName: option.colorName ?? '',
              colorHex: option.colorHex ?? '',
              spoolmanSpoolId: option.spoolmanSpoolId ?? null,
            })
          }
        }}
      >
        <option value="">Any — no preference</option>
        {[...new Set(options.map((option) => option.group))].map((group) => (
          <optgroup key={group} label={group}>
            {options
              .filter((option) => option.group === group)
              .map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
          </optgroup>
        ))}
        <option value={CUSTOM}>Other…</option>
      </Select>

      {mode === CUSTOM && (
        <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
          <Input
            aria-label="Material"
            list={`${id}-materials`}
            placeholder="Material, e.g. PETG"
            value={value.material}
            onChange={(event) =>
              onChange({ ...value, material: event.target.value, spoolmanSpoolId: null })
            }
          />
          <datalist id={`${id}-materials`}>
            {materials.map((material) => (
              <option key={material} value={material} />
            ))}
          </datalist>
          <Input
            aria-label="Colour name"
            placeholder="Colour, e.g. Galaxy Black"
            value={value.colorName}
            onChange={(event) =>
              onChange({ ...value, colorName: event.target.value, spoolmanSpoolId: null })
            }
          />
          <span className="flex items-center gap-1">
            <input
              type="color"
              aria-label="Colour"
              value={value.colorHex || '#808080'}
              onChange={(event) =>
                onChange({
                  ...value,
                  colorHex: event.target.value.toLowerCase(),
                  spoolmanSpoolId: null,
                })
              }
              className={
                value.colorHex
                  ? 'size-9 cursor-pointer rounded-[var(--radius-control)] border border-[var(--color-border)] bg-transparent'
                  : 'size-9 cursor-pointer rounded-[var(--radius-control)] border border-dashed border-[var(--color-border)] bg-transparent opacity-50'
              }
            />
            {value.colorHex && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="No specific colour"
                title="No specific colour"
                onClick={() => onChange({ ...value, colorHex: '', spoolmanSpoolId: null })}
              >
                <X />
              </Button>
            )}
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * Print time for ONE print, typed the way slicers show it ("2h 10m", "2:10").
 *
 * `hint` says where a pre-filled value came from, so a suggestion is never
 * mistaken for a measurement.
 */
export function EstimateInput({
  id,
  value,
  onChange,
  hint,
  quantity,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  hint?: string | null
  quantity: number
}) {
  const parsed = parseEstimate(value)
  const invalid = value.trim().length > 0 && parsed == null

  return (
    <Field
      label={
        <>
          Print time <span className="font-normal text-[var(--color-ink-faint)]">(one print)</span>
        </>
      }
      htmlFor={id}
      hint={
        invalid
          ? undefined
          : parsed != null && quantity > 1
            ? `${formatEstimate(parsed * quantity)} for all ${quantity}`
            : (hint ?? 'Optional')
      }
      error={invalid ? 'Try "2h 10m", "2:10" or a number of minutes.' : undefined}
    >
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="e.g. 2h 10m"
      />
    </Field>
  )
}

/** The text field's value for a stored estimate. */
export function estimateText(minutes: number | null | undefined): string {
  return minutes != null ? formatEstimate(minutes) : ''
}

/** What to send: null for blank, undefined when the text does not parse (caller refuses). */
export function estimateValue(text: string): number | null | undefined {
  if (text.trim().length === 0) return null
  return parseEstimate(text) ?? undefined
}

export function suggestionHint(source: 'gcode' | 'history'): string {
  return source === 'gcode' ? "From the slicer's estimate in the G-code" : 'From earlier prints'
}
