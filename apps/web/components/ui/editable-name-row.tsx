'use client'

import { useState } from 'react'
import { Check, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from './button'
import { Input } from './input'

/**
 * The inline rename in a managed list (tags, collections): the name becomes a
 * field with save and cancel beside it. Enter saves, Escape cancels. Renders
 * its controls inline so the row around it keeps its own layout.
 */
export function EditableNameRow({
  initial,
  label,
  pending = false,
  onSave,
  onCancel,
  className,
}: {
  initial: string
  /** Accessible name of the field, e.g. "Name of Dragons". */
  label: string
  pending?: boolean
  onSave: (name: string) => void
  onCancel: () => void
  className?: string
}) {
  const [draft, setDraft] = useState(initial)

  return (
    <>
      <Input
        autoFocus
        aria-label={label}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onSave(draft)
          if (event.key === 'Escape') onCancel()
        }}
        className={cn('h-8 max-w-64', className)}
      />
      <Button size="sm" aria-label="Save name" disabled={pending} onClick={() => onSave(draft)}>
        {pending ? <Loader2 className="animate-spin" /> : <Check />}
      </Button>
      <Button size="sm" variant="ghost" aria-label="Cancel rename" onClick={onCancel}>
        <X />
      </Button>
    </>
  )
}
