'use client'

import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { MAX_PASSWORD, MIN_PASSWORD } from '@/lib/password'

/** Matches the server's PASSWORD_MAX_LENGTH in @pb/auth. */

/**
 * A new password and its confirmation, checked as the user types.
 *
 * The inputs stay uncontrolled so a plain `form.reset()` clears them; the
 * length and match are tracked alongside. A mismatch is also set as the
 * confirmation's custom validity, so the browser refuses to submit the form
 * and the surrounding onSubmit never needs to compare the two itself.
 */
export function NewPasswordFields({
  name = 'password',
  confirmName = 'confirmation',
  label = 'New password',
  disabled,
}: {
  /** The field name the form's server action reads. */
  name?: string
  confirmName?: string
  label?: string
  disabled?: boolean
}) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const confirmRef = useRef<HTMLInputElement>(null)

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD
  const mismatch = confirmation.length > 0 && confirmation !== password
  // Only complain once the confirmation has gone wrong, not while it is still catching up.
  const showMismatch =
    mismatch && (confirmation.length >= password.length || !password.startsWith(confirmation))

  useEffect(() => {
    confirmRef.current?.setCustomValidity(mismatch ? 'The passwords do not match.' : '')
  }, [mismatch])

  useEffect(() => {
    const form = confirmRef.current?.form
    if (!form) return
    const clear = () => {
      setPassword('')
      setConfirmation('')
    }
    form.addEventListener('reset', clear)
    return () => form.removeEventListener('reset', clear)
  }, [])

  return (
    <>
      <Field
        label={label}
        htmlFor={name}
        hint={`Between ${MIN_PASSWORD} and ${MAX_PASSWORD} characters. A passphrase of a few words beats a short complex one.`}
        error={tooShort ? `Needs at least ${MIN_PASSWORD} characters.` : undefined}
      >
        <Input
          name={name}
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD}
          maxLength={MAX_PASSWORD}
          disabled={disabled}
          onChange={(event) => setPassword(event.target.value)}
        />
      </Field>
      <Field
        label={`Confirm ${label.toLowerCase()}`}
        htmlFor={confirmName}
        error={showMismatch ? 'The passwords do not match.' : undefined}
      >
        <Input
          ref={confirmRef}
          name={confirmName}
          type="password"
          autoComplete="new-password"
          required
          maxLength={MAX_PASSWORD}
          disabled={disabled}
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </Field>
    </>
  )
}
