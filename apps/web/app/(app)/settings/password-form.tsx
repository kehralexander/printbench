'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { NewPasswordFields } from '@/components/auth/new-password-fields'
import { MAX_PASSWORD } from '@/lib/password'
import { changeOwnPassword } from './password-actions'

export function PasswordForm({ email }: { email: string }) {
  const [message, setMessage] = useState('')
  const [pending, startTransition] = useTransition()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const currentPassword = String(data.get('currentPassword') ?? '')
    const newPassword = String(data.get('newPassword') ?? '')
    setMessage('')
    startTransition(async () => {
      try {
        const result = await changeOwnPassword({ currentPassword, newPassword })
        if (!result.ok) {
          setMessage(result.error)
          return
        }
        form.reset()
        setMessage('Password changed. Your other sessions have been signed out.')
      } catch {
        setMessage('Could not change your password. Please try again.')
      }
    })
  }

  return (
    <Card id="password" role="region" aria-labelledby="password-heading">
      <CardHeader>
        <CardTitle id="password-heading">Password</CardTitle>
        <CardDescription>
          Signed in as {email}. Changing your password signs out your other sessions.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <input type="hidden" name="username" value={email} autoComplete="username" />
          <Field label="Current password" htmlFor="currentPassword">
            <Input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              maxLength={MAX_PASSWORD}
              disabled={pending}
            />
          </Field>
          <NewPasswordFields name="newPassword" confirmName="confirmPassword" disabled={pending} />
          <Button type="submit" disabled={pending}>
            {pending ? 'Changing…' : 'Change password'}
          </Button>
          <p role="status" aria-live="polite" className="text-sm">
            {message}
          </p>
        </form>
      </CardContent>
    </Card>
  )
}
