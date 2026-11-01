'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Link2, Loader2, UserPlus, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { Select } from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CopyButton } from '@/components/ui/copy-button'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { LocalTime } from '@/components/ui/local-time'
import { SortControl } from '@/components/ui/sort-control'
import { compareAsc, compareDesc, compareText, type SortOption } from '@/lib/sort'
import { MIN_PASSWORD } from '@/lib/password'
import { addUser, cancelInvite, invite } from './actions'
import { ROLE_CHOICES, ROLE_LABELS } from './roles'

/**
 * The two ways to get somebody in, as the page header's actions.
 *
 * An invitation link is the default, because it lets the person choose their
 * own password — an admin who types someone's password knows it, which is a
 * worse starting point than a link they redeem themselves.
 *
 * Nothing is emailed. A self-hosted instance rarely has SMTP configured, so
 * the link is shown for the admin to copy and send however they already talk
 * to that person. Saying so plainly avoids the obvious question of why no
 * email arrived.
 */

export interface PendingInvite {
  id: string
  token: string
  email: string | null
  role: string
  expiresAt: string
  invitedByName: string | null
}

export function AddPeopleActions({
  origin,
}: {
  /** Rendered server-side, so the copied link matches how people reach this instance. */
  origin: string
}) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [inviting, setInviting] = useState(false)

  return (
    <>
      <Dialog open={inviting} onOpenChange={setInviting}>
        <DialogTrigger asChild>
          <Button>
            <Link2 />
            Invite someone
          </Button>
        </DialogTrigger>
        <DialogContent
          title="Invite someone"
          description="Creates a link that lets one person set up their own account. Nothing is emailed. Copy the link and send it however you like. It expires in 14 days and works once."
        >
          <InviteForm
            origin={origin}
            onDone={() => router.refresh()}
            onClose={() => setInviting(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogTrigger asChild>
          <Button variant="secondary">
            <UserPlus />
            Create an account
          </Button>
        </DialogTrigger>
        <DialogContent
          title="Create an account"
          description="Sets up an account with a password you choose and pass on. An invitation link is usually better because it lets them pick a password you never see."
        >
          <AddUserForm
            onDone={() => {
              setAdding(false)
              router.refresh()
            }}
            onCancel={() => setAdding(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}

function RoleOptions() {
  return ROLE_CHOICES.map((r) => (
    <option key={r} value={r}>
      {ROLE_LABELS[r]}
    </option>
  ))
}

function InviteForm({
  origin,
  onDone,
  onClose,
}: {
  origin: string
  onDone: () => void
  onClose: () => void
}) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('viewer')
  const [error, setError] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [saving, startSaving] = useTransition()

  function create() {
    setError(null)
    startSaving(async () => {
      const result = await invite({ email: email.trim() || undefined, role })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setLink(`${origin}/invite/${result.token}`)
      setEmail('')
      onDone()
    })
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Email"
          htmlFor="invite-email"
          hint="Optional. Locks the invitation to one address and pre-fills it for them."
        >
          <Input
            name="invite-email"
            type="email"
            value={email}
            placeholder="them@example.com"
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>

        <Field label="Role" htmlFor="invite-role">
          <Select name="invite-role" value={role} onChange={(e) => setRole(e.target.value)}>
            <RoleOptions />
          </Select>
        </Field>
      </div>

      {error && (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {error}
        </p>
      )}

      {link ? <CopyRow label="Invitation link" value={link} /> : null}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {link ? 'Close' : 'Cancel'}
        </Button>
        <Button disabled={saving} onClick={create}>
          {saving ? <Loader2 className="animate-spin" /> : <Link2 />}
          {link ? 'Create another link' : 'Create link'}
        </Button>
      </div>
    </div>
  )
}

function AddUserForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('viewer')
  const [error, setError] = useState<string | null>(null)
  const [saving, startSaving] = useTransition()

  const ready = name.trim() && email.trim() && password.length >= MIN_PASSWORD

  function create() {
    setError(null)
    startSaving(async () => {
      const result = await addUser({ name, email, password, role })
      if (!result.ok) {
        setError(result.error)
        return
      }
      onDone()
    })
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="add-name">
          <Input name="add-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email" htmlFor="add-email">
          <Input
            name="add-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field
          label="Password"
          htmlFor="add-password"
          hint={`At least ${MIN_PASSWORD} characters.`}
        >
          <Input
            name="add-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Field label="Role" htmlFor="add-role">
          <Select name="add-role" value={role} onChange={(e) => setRole(e.target.value)}>
            <RoleOptions />
          </Select>
        </Field>
      </div>

      {error && (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={saving || !ready} onClick={create}>
          {saving ? <Loader2 className="animate-spin" /> : <UserPlus />}
          Create account
        </Button>
      </div>
    </div>
  )
}

/** Invitations nobody has redeemed yet, newest first. */
type InviteSort = 'expiring' | 'latest' | 'email' | 'role'

const INVITE_SORTS: SortOption<InviteSort>[] = [
  { value: 'expiring', label: 'Expiring soonest' },
  { value: 'latest', label: 'Expiring last' },
  { value: 'email', label: 'Email' },
  { value: 'role', label: 'Role' },
]

export function PendingInvites({ invites, origin }: { invites: PendingInvite[]; origin: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [sort, setSort] = useState<InviteSort>('expiring')

  if (invites.length === 0) return null

  const sorted = [...invites].sort((a, b) => {
    switch (sort) {
      case 'latest':
        return compareDesc(a.expiresAt, b.expiresAt)
      case 'email':
        return compareText(a.email ?? '\uffff', b.email ?? '\uffff')
      case 'role':
        return ROLE_CHOICES.indexOf(a.role as never) - ROLE_CHOICES.indexOf(b.role as never)
      default:
        return compareAsc(a.expiresAt, b.expiresAt)
    }
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Unused invitations</CardTitle>
        <CardDescription>
          Anyone holding one of these links can create an account with the role shown. Cancel one
          you did not mean to send.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && <p className="mb-2 text-xs text-[var(--color-danger)]">{error}</p>}

        <ListToolbar
          sort={
            <SortControl
              options={INVITE_SORTS}
              value={sort}
              onChange={setSort}
              count={invites.length}
            />
          }
        />

        <ul className="divide-y divide-[var(--color-border)]">
          {sorted.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center gap-3 py-2">
              {/* basis-56: the details keep a readable width, and the buttons
                  wrap below them on a phone instead of squeezing them. */}
              <div className="min-w-0 flex-1 basis-56">
                <p className="flex min-w-0 items-center gap-2 text-sm">
                  <span className="truncate">{entry.email ?? 'Anyone with the link'}</span>
                  <Badge tone="neutral">{ROLE_LABELS[entry.role] ?? entry.role}</Badge>
                </p>
                <p className="text-xs text-[var(--color-ink-faint)]">
                  {entry.invitedByName ? `Invited by ${entry.invitedByName} · ` : ''}
                  expires <LocalTime value={entry.expiresAt} />
                </p>
              </div>

              <CopyButton value={`${origin}/invite/${entry.token}`} />

              <Button
                variant="ghost"
                size="sm"
                className="hover:text-[var(--color-danger)]"
                disabled={pending}
                onClick={() => {
                  setError(null)
                  startTransition(async () => {
                    const result = await cancelInvite(entry.id)
                    if (!result.ok) setError(result.error)
                    else router.refresh()
                  })
                }}
              >
                <X />
                Cancel
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
      <p className="text-xs font-medium">{label}</p>
      <div className="mt-1.5 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate font-mono text-xs">{value}</code>
        <CopyButton value={value} />
      </div>
    </div>
  )
}
