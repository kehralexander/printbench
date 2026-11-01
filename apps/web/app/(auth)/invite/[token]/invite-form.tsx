'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { NewPasswordFields } from '@/components/auth/new-password-fields'
import { acceptInvite } from './actions'

export function InviteForm({
  token,
  email,
}: {
  token: string
  /** Fixed when the invitation named an address; chosen by them otherwise. */
  email: string | null
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const form = new FormData(event.currentTarget)

    const result = await acceptInvite(form)
    if (!result.ok) {
      setError(result.error)
      return
    }
    startTransition(() => {
      router.push('/')
      router.refresh()
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="token" value={token} />

      <Field label="Your name" htmlFor="name">
        <Input name="name" autoComplete="name" required autoFocus />
      </Field>

      <Field label="Email" htmlFor="email" hint={email ? 'Set by whoever invited you.' : undefined}>
        <Input
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={email ?? ''}
          // Fixed rather than merely pre-filled: the invitation was addressed
          // to this person. The server ignores the field in that case anyway.
          readOnly={Boolean(email)}
        />
      </Field>

      <NewPasswordFields label="Password" disabled={pending} />

      {error && (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {error}
        </p>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Creating…' : 'Create my account'}
        <ArrowRight />
      </Button>
    </form>
  )
}
