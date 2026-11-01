'use client'

import { useState } from 'react'
import { Check, Copy, X } from 'lucide-react'
import { Button, type ButtonProps } from './button'

/**
 * Copies a value to the clipboard and says so for two seconds.
 *
 * The clipboard API only exists on HTTPS or localhost, and many installs are
 * plain HTTP on a LAN — so a failed copy says so too, rather than doing nothing.
 * The value is always on screen next to this button to select by hand.
 */
export function CopyButton({
  value,
  label = 'Copy link',
  variant = 'secondary',
  size = 'sm',
  ...props
}: { value: string; label?: string } & Omit<ButtonProps, 'onClick' | 'children'>) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={() => {
        const settle = (next: 'copied' | 'failed') => {
          setState(next)
          setTimeout(() => setState('idle'), 2000)
        }
        Promise.resolve()
          .then(() => navigator.clipboard.writeText(value))
          .then(
            () => settle('copied'),
            () => settle('failed'),
          )
      }}
      {...props}
    >
      {state === 'copied' ? <Check /> : state === 'failed' ? <X /> : <Copy />}
      {size !== 'icon' &&
        (state === 'copied'
          ? 'Copied'
          : state === 'failed'
            ? 'Copy failed — select it instead'
            : label)}
    </Button>
  )
}
