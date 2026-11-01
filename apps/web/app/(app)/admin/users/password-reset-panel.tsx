'use client'

import { useState, useTransition } from 'react'
import { KeyRound, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { Input } from '@/components/ui/input'
import { LocalTime } from '@/components/ui/local-time'
import { createPasswordResetLink } from './password-reset-actions'

/** The "Reset password" step of a user's actions menu. */
export function PasswordResetPanel({
  userId,
  email,
  onBack,
}: {
  userId: string
  email: string
  onBack: () => void
}) {
  const [url, setUrl] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  return (
    <>
      <p className="text-sm font-medium">Reset password for {email}</p>
      <p className="text-xs text-[var(--color-ink-muted)]">
        Create a private, single-use link valid for one hour. Share it with the account owner. No
        email is sent. Creating a new link replaces their previous one.
      </p>
      {url ? (
        <>
          <Input
            aria-label="Password reset link"
            value={url}
            readOnly
            autoComplete="off"
            onFocus={(event) => event.currentTarget.select()}
          />
          <p className="text-xs text-[var(--color-ink-muted)]">
            Expires <LocalTime value={expiresAt} />.
          </p>
        </>
      ) : null}
      <div className="flex gap-2">
        {url ? (
          <CopyButton value={url} variant="primary" />
        ) : (
          <Button
            size="sm"
            disabled={pending}
            onClick={() => {
              setError('')
              startTransition(async () => {
                try {
                  const result = await createPasswordResetLink(userId)
                  if (!result.ok) {
                    setError(result.error)
                    return
                  }
                  setUrl(result.url)
                  setExpiresAt(result.expiresAt)
                } catch {
                  setError('Could not create a password reset link.')
                }
              })
            }}
          >
            {pending ? <Loader2 className="animate-spin" /> : <KeyRound />}
            {pending ? 'Creating…' : 'Create reset link'}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onBack}>
          {url ? 'Done' : 'Cancel'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-[var(--color-danger)]">
          {error}
        </p>
      )}
    </>
  )
}
