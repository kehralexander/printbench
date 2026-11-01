'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { NewPasswordFields } from '@/components/auth/new-password-fields'
import { createFirstAdmin } from './actions'

export function SetupForm() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const form = new FormData(event.currentTarget)

    const result = await createFirstAdmin(form)
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
      <Field label="Your name" htmlFor="name">
        <Input name="name" autoComplete="name" required autoFocus />
      </Field>
      <Field label="Email" htmlFor="email">
        <Input name="email" type="email" autoComplete="email" required />
      </Field>
      <NewPasswordFields label="Password" disabled={pending} />

      {error && (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {error}
        </p>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Creating…' : 'Create admin account'}
        <ArrowRight />
      </Button>
    </form>
  )
}
