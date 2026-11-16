'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Pencil, Plus, Trash2, UserRound } from 'lucide-react'
import type { Customer, PricingTier } from '@pb/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { createCustomer, deleteCustomer, updateCustomer } from './actions'

/** The "Add a customer" button and its dialog, for the header and the empty state. */
export function AddCustomerButton({
  tiers,
  variant,
}: {
  tiers: PricingTier[]
  variant?: 'primary' | 'secondary'
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant}>
          <Plus />
          Add a customer
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Add a customer"
        description="Requests already raised under this name are linked to them."
      >
        <CustomerForm
          customer={null}
          tiers={tiers}
          onDone={() => {
            setOpen(false)
            router.refresh()
          }}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

export function CustomerList({
  customers,
  tiers,
}: {
  customers: Customer[]
  tiers: PricingTier[]
}) {
  const router = useRouter()
  const [editing, setEditing] = useState<Customer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function remove(customer: Customer) {
    if (
      !confirm(
        `Remove ${customer.name}? Their requests keep the name they were asked under, and their payments stay.`,
      )
    ) {
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await deleteCustomer(customer.id, customer.name)
      if (!result.ok) setError(result.error)
      router.refresh()
    })
  }

  if (customers.length === 0) {
    return (
      <EmptyState
        icon={<UserRound />}
        title="No customers yet"
        description="Anyone who asks is counted by the name they gave. Add the people you print for often, so a typo does not split their balance in two and they get their own tier."
        action={<AddCustomerButton tiers={tiers} variant="secondary" />}
      />
    )
  }

  const tierLabel = (key: string | null) =>
    key ? (tiers.find((tier) => tier.key === key)?.label ?? key) : null

  return (
    <>
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent title={editing ? `Edit ${editing.name}` : 'Edit customer'}>
          {editing && (
            <CustomerForm
              key={editing.id}
              customer={editing}
              tiers={tiers}
              onDone={() => {
                setEditing(null)
                router.refresh()
              }}
              onCancel={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {error && <p className="mb-2 text-sm text-[var(--color-danger)]">{error}</p>}

      <Card className="overflow-hidden">
        <ul className="divide-y divide-[var(--color-border)]">
          {customers.map((customer) => (
            <li key={customer.id} className="flex min-w-0 flex-wrap items-center gap-3 px-4 py-3">
              <UserRound className="size-4 shrink-0 text-[var(--color-ink-faint)]" />
              <div className="min-w-0 flex-1 basis-40">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {customer.name}
                  {customer.defaultTier && (
                    <Badge tone="accent">{tierLabel(customer.defaultTier)}</Badge>
                  )}
                </p>
                {customer.contact && (
                  <p className="truncate text-xs text-[var(--color-ink-muted)]">
                    {customer.contact}
                  </p>
                )}
                {customer.notes && (
                  <p className="line-clamp-2 text-xs text-[var(--color-ink-faint)]">
                    {customer.notes}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Edit ${customer.name}`}
                  onClick={() => setEditing(customer)}
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${customer.name}`}
                  className="hover:text-[var(--color-danger)]"
                  onClick={() => remove(customer)}
                  disabled={pending}
                >
                  <Trash2 />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}

function CustomerForm({
  customer,
  tiers,
  onDone,
  onCancel,
}: {
  customer: Customer | null
  tiers: PricingTier[]
  onDone: () => void
  onCancel: () => void
}) {
  const [name, setName] = useState(customer?.name ?? '')
  const [contact, setContact] = useState(customer?.contact ?? '')
  const [defaultTier, setDefaultTier] = useState(customer?.defaultTier ?? '')
  const [notes, setNotes] = useState(customer?.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // A tier since removed from the settings still shows, rather than silently
  // reading as the default and being cleared on the next save.
  const unknownTier = defaultTier && !tiers.some((tier) => tier.key === defaultTier)

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    const input = { name, contact, defaultTier: defaultTier || null, notes }
    startTransition(async () => {
      const result = customer
        ? await updateCustomer(customer.id, input)
        : await createCustomer(input)
      if (!result.ok) setError(result.error)
      else onDone()
    })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Name"
          htmlFor="customer-name"
          hint="As it is typed in “requested by”. Capitals do not matter."
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tom" />
        </Field>

        <Field label="Default tier" htmlFor="customer-tier" hint="Used when a request names none.">
          <Select value={defaultTier} onChange={(e) => setDefaultTier(e.target.value)}>
            <option value="">Instance default</option>
            {tiers.map((tier) => (
              <option key={tier.key} value={tier.key}>
                {tier.label}
              </option>
            ))}
            {unknownTier && <option value={defaultTier}>{defaultTier} (no longer set up)</option>}
          </Select>
        </Field>

        <Field
          label="Contact"
          htmlFor="customer-contact"
          hint="Email, phone or address."
          className="sm:col-span-2"
        >
          <Textarea value={contact} onChange={(e) => setContact(e.target.value)} rows={2} />
        </Field>

        <Field label="Notes" htmlFor="customer-notes" className="sm:col-span-2">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </Field>
      </div>

      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          {customer ? 'Save' : 'Add customer'}
        </Button>
      </div>
    </form>
  )
}
