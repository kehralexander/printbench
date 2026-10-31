'use client'

import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { signIn } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'

export function SsoButton({ providerId, name }: { providerId: string; name: string }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onClick() {
    setError(null)
    setPending(true)
    // Redirects to the provider; failures come back as /login?error=…
    const { error: authError } = await signIn.social({
      provider: providerId,
      callbackURL: '/',
      errorCallbackURL: '/login',
    })
    if (authError) {
      setError(`Could not reach ${name}.`)
      setPending(false)
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="secondary"
        size="lg"
        className="w-full"
        disabled={pending}
        onClick={onClick}
      >
        <KeyRound />
        {pending ? 'Redirecting…' : `Sign in with ${name}`}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {error}
        </p>
      )}
    </div>
  )
}
