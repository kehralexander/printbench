'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { setThingiverseToken } from './thingiverse-actions'

export function ThingiverseConnectionForm({ initialSaved }: { initialSaved: boolean }) {
  const [token, setToken] = useState('')
  const [saved, setSaved] = useState(initialSaved)
  const [message, setMessage] = useState('')
  const [pending, startTransition] = useTransition()

  function updateToken(value: string) {
    setMessage('')
    startTransition(async () => {
      try {
        const result = await setThingiverseToken(value)
        if (!result.ok) {
          setMessage(result.error)
          return
        }
        setSaved(result.saved)
        setToken('')
        setMessage(result.saved ? 'API token saved for your account.' : 'API token removed.')
      } catch {
        setMessage('Could not update your Thingiverse connection.')
      }
    })
  }

  return (
    <Card id="thingiverse" role="region" aria-labelledby="thingiverse-heading">
      <CardHeader>
        <CardTitle id="thingiverse-heading">Thingiverse</CardTitle>
        <CardDescription>
          Save your own Thingiverse API token to import model links. It is saved for your PrintBench
          account and never shown again. See{' '}
          <a
            href="https://www.thingiverse.com/developers"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--color-accent)] hover:underline"
          >
            Thingiverse’s developer documentation
          </a>{' '}
          to create an app and obtain a token.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm">API token: {saved ? 'Saved' : 'Not saved'}</p>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            updateToken(token)
          }}
        >
          <Field label="API token" htmlFor="thingiverse-token">
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              disabled={pending}
            />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" disabled={pending || !token.trim()}>
              {pending ? 'Updating…' : 'Save API token'}
            </Button>
            {/* Only once there is one: a greyed-out "Remove" said nothing useful. */}
            {saved && (
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => updateToken('')}
              >
                Remove API token
              </Button>
            )}
          </div>
          <p role="status" aria-live="polite" className="text-sm">
            {message}
          </p>
        </form>
      </CardContent>
    </Card>
  )
}
