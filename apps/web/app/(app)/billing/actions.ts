'use server'

import { revalidatePath } from 'next/cache'
import {
  BillingError,
  PolicyError,
  assertCan,
  balances,
  createCustomer as createCustomerRow,
  createInvoice,
  deleteCustomer as deleteCustomerRow,
  getSettings,
  updateCustomer as updateCustomerRow,
  type CustomerInput,
} from '@pb/core'
import { requireUser } from '@pb/auth'
import { getDb } from '@pb/db'
import { audit } from '@/lib/audit'

type Result = { ok: true } | { ok: false; error: string }

type InvoiceResult = { ok: true; id: string; number: number } | { ok: false; error: string }

/** Money is a member's business, never a viewer's. */
async function authorize() {
  const user = await requireUser()
  assertCan(
    { id: user.id, role: user.role ?? null, banned: user.banned ?? false },
    'billing:manage',
  )
  return user
}

function refresh() {
  revalidatePath('/billing')
  // Invoicing moves price statuses, and the queue shows them.
  revalidatePath('/queue')
}

export async function createCustomer(input: CustomerInput): Promise<Result> {
  try {
    const user = await authorize()
    const id = await createCustomerRow(getDb(), input)
    await audit(user, 'customer.created', { type: 'customer', id, label: input.name.trim() })
    refresh()
    return { ok: true }
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not add that customer.') }
  }
}

export async function updateCustomer(id: string, input: CustomerInput): Promise<Result> {
  try {
    const user = await authorize()
    await updateCustomerRow(getDb(), id, input)
    await audit(user, 'customer.updated', { type: 'customer', id, label: input.name.trim() })
    refresh()
    return { ok: true }
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not save that customer.') }
  }
}

export async function deleteCustomer(id: string, name: string): Promise<Result> {
  try {
    const user = await authorize()
    await deleteCustomerRow(getDb(), id)
    await audit(user, 'customer.deleted', { type: 'customer', id, label: name })
    refresh()
    return { ok: true }
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not remove that customer.') }
  }
}

/**
 * One invoice for everything a customer has agreed to and not yet been
 * invoiced for. The requests are picked here, from the current balances,
 * rather than trusted from the browser: the page may be minutes old.
 */
export async function invoiceOpenItems(input: {
  customerId: string | null
  name: string
}): Promise<InvoiceResult> {
  try {
    const user = await authorize()
    const db = getDb()
    const { pricing } = await getSettings(db)
    if (!pricing.enabled) return { ok: false, error: 'Pricing is turned off.' }

    const group = (await balances(db)).find((balance) =>
      input.customerId
        ? balance.customerId === input.customerId
        : balance.customerId === null && balance.name.toLowerCase() === input.name.toLowerCase(),
    )
    const requestIds = (group?.requests ?? [])
      .filter(
        (request) =>
          (request.priceStatus === 'accepted' || request.priceStatus === 'paid') &&
          // An accepted price on a cancelled request is not owed; balances agree.
          !(request.status === 'cancelled' && request.priceStatus === 'accepted') &&
          request.invoiceNumber == null &&
          request.price != null,
      )
      .map((request) => request.id)
    if (requestIds.length === 0) return { ok: false, error: 'Nothing open to invoice.' }

    const invoice = await createInvoice(db, { requestIds }, pricing, user.id)
    await audit(
      user,
      'invoice.created',
      { type: 'invoice', id: invoice.id, label: `Invoice ${invoice.number}` },
      {
        recipient: invoice.recipient ?? undefined,
        requests: requestIds.length,
        total: invoice.total,
        currency: invoice.currency,
      },
    )
    refresh()
    return { ok: true, id: invoice.id, number: invoice.number }
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not write that invoice.') }
  }
}

function describe(error: unknown, fallback: string): string {
  if (error instanceof BillingError) return error.message
  if (error instanceof PolicyError) return 'Not permitted.'
  console.error('[billing]', error)
  return fallback
}
