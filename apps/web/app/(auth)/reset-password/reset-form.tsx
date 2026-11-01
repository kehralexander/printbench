'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { BackToSignIn } from '@/components/auth/back-to-sign-in'
import { NewPasswordFields } from '@/components/auth/new-password-fields'
import { completePasswordReset } from './actions'

export function ResetPasswordForm({ token }: { token: string }) {
  const [message, setMessage] = useState('')
  const [complete, setComplete] = useState(false)
  const [pending, startTransition] = useTransition()
  if (complete)
    return (
      <div className="space-y-4">
        <p role="status">Your password has been reset. Sign in with your new password.</p>
        <BackToSignIn />
      </div>
    )
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        const form = event.currentTarget
        const password = String(new FormData(form).get('password') ?? '')
        setMessage('')
        startTransition(async () => {
          try {
            const result = await completePasswordReset({ token, password })
            if (!result.ok) {
              setMessage(result.error)
              return
            }
            form.reset()
            window.history.replaceState(null, '', '/reset-password')
            setComplete(true)
          } catch {
            setMessage('Could not reset your password. Please try again.')
          }
        })
      }}
    >
      <NewPasswordFields disabled={pending} />
      {message && (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {message}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Resetting…' : 'Reset password'}
      </Button>
    </form>
  )
}
