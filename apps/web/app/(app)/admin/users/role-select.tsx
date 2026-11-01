'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Select } from '@/components/ui/select'
import { setUserRole } from './actions'
import { ROLE_CHOICES, ROLE_LABELS } from './roles'

export function RoleSelect({
  userId,
  role,
  disabled,
}: {
  userId: string
  role: string
  disabled?: boolean
}) {
  const router = useRouter()
  const [value, setValue] = useState(role)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onChange(next: string) {
    const previous = value
    setValue(next)
    setError(null)
    startTransition(async () => {
      const result = await setUserRole(userId, next)
      if (!result.ok) {
        setValue(previous) // roll back the optimistic change
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="flex items-center gap-2">
      <Select
        value={value}
        disabled={disabled || pending}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Role"
        className="h-8 w-auto disabled:cursor-not-allowed"
        title={disabled ? 'You cannot change your own role' : undefined}
      >
        {ROLE_CHOICES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </Select>
      {error && <span className="text-xs text-[var(--color-danger)]">{error}</span>}
    </div>
  )
}
