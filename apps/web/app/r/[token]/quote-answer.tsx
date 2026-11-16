'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { answerQuote } from './actions'

/** Accept and Decline for a quote; the page re-renders with the new status once answered. */
export function QuoteAnswer({ token }: { token: string }) {
  const [pending, startTransition] = useTransition()
  const [answering, setAnswering] = useState<'accept' | 'decline' | null>(null)
  const [error, setError] = useState<string | null>(null)

  function answer(value: 'accept' | 'decline') {
    // Declining ends the request's chance of being printed at this price, so
    // it asks first; accepting is what the page is waiting for.
    if (value === 'decline' && !confirm('Decline this price?')) return
    setError(null)
    setAnswering(value)
    startTransition(async () => {
      const result = await answerQuote(token, value)
      if (!result.ok) setError(result.error)
      setAnswering(null)
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button onClick={() => answer('accept')} disabled={pending}>
          {pending && answering === 'accept' ? 'Accepting…' : 'Accept price'}
        </Button>
        <Button variant="secondary" onClick={() => answer('decline')} disabled={pending}>
          {pending && answering === 'decline' ? 'Declining…' : 'Decline'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {error}
        </p>
      )}
    </div>
  )
}
