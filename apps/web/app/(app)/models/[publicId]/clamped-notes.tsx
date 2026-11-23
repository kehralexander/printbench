'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'

/**
 * A model's description, cut to a few lines with a way to read the rest.
 * The toggle only appears when there is more to read.
 */
export function ClampedNotes({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [open, setOpen] = useState(false)
  const [overflows, setOverflows] = useState(false)

  useLayoutEffect(() => {
    const element = ref.current
    if (element && !open) setOverflows(element.scrollHeight > element.clientHeight + 1)
  }, [text, open])

  return (
    <div>
      <p
        ref={ref}
        className={cn(
          'whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--color-ink-muted)]',
          !open && 'line-clamp-6',
        )}
      >
        {text}
      </p>
      {(overflows || open) && (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="mt-1 text-xs text-[var(--color-accent)] hover:underline"
        >
          {open ? 'Show less' : 'Read more'}
        </button>
      )}
    </div>
  )
}
