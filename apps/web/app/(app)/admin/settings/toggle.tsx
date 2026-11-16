'use client'

import { Checkbox } from '@/components/ui/checkbox'

/** A checkbox with its label and a line saying what it does, as the settings page uses them. */
export function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <Checkbox checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[var(--color-ink)]">{label}</span>
        <span className="block text-xs text-[var(--color-ink-faint)]">{hint}</span>
      </span>
    </label>
  )
}
