import { and, eq, isNull, sql } from 'drizzle-orm'
import { schema, type Database, type InvoiceLine } from '@pb/db'
import type { SpoolmanSpool } from '../spoolman/spoolman'
import { renderPdf, wrapText, PAGE_WIDTH, type PdfItem } from './pdf'
import {
  OWED_STATUSES,
  cents,
  formatMoney,
  pickTier,
  quotePrint,
  successRateFrom,
  type PriceStatus,
  type PricingSettings,
  type PricingTier,
  type Quote,
  type QuoteFilament,
} from './pricing'
import {
  isParsableSlicerFile,
  readGcodeMetadata,
  storedSlicerMeta,
} from './slicer-metadata-service'
import { createStorageAdapter, libraryLocationFromRow } from '../storage/factory'
import { getRequest, type PrintRequest } from './request-service'

/**
 * Charging for prints: quoting a request, the requester's answer, payments,
 * customers and what they owe, and receipts.
 *
 * The arithmetic is pricing.ts; this is the half that reads what it needs —
 * spool prices, printer rates, print history — and keeps the record.
 */

export class BillingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BillingError'
  }
}

/* ------------------------------------------------------------------ *
 * Quoting
 * ------------------------------------------------------------------ */

export interface RequestQuote extends Quote {
  tier: PricingTier
  successRate: number
  /** Where the success rate came from, so the editor can say. */
  successFrom: 'model' | 'printer' | 'default'
}

/**
 * The price of a request as it stands now, without saving anything.
 *
 * Cost per gram comes from, in order: PrintBench's own spool (purchase cost
 * over weight), the Spoolman spool (its price, else its filament's, over
 * weight), then the material default in the settings.
 */
export async function priceRequest(
  db: Database,
  request: PrintRequest,
  pricing: PricingSettings,
  spoolman: SpoolmanSpool[] | null = null,
): Promise<RequestQuote> {
  const localIds = request.filaments.map((row) => row.spoolId).filter((id): id is string => !!id)
  const local = new Map<string, number | null>()
  if (localIds.length > 0) {
    const rows = await db.execute<{ id: string; cost: string | null; weight: string }>(sql`
      SELECT id, purchase_cost AS cost, nominal_weight_g AS weight
      FROM filament_spools WHERE id = ANY(${sql.param(localIds)}::uuid[])`)
    for (const row of rows.rows) {
      local.set(
        row.id,
        row.cost != null && Number(row.weight) > 0 ? Number(row.cost) / Number(row.weight) : null,
      )
    }
  }
  const spoolmanCost = new Map((spoolman ?? []).map((spool) => [spool.id, spool.costPerGram]))

  const filaments: QuoteFilament[] = request.filaments.map((row) => ({
    grams: row.grams,
    costPerGram:
      (row.spoolId ? local.get(row.spoolId) : null) ??
      (row.spoolmanSpoolId != null ? spoolmanCost.get(row.spoolmanSpoolId) : null) ??
      null,
    material: row.material,
    label:
      row.spoolmanSpoolId != null
        ? `spool #${row.spoolmanSpoolId}`
        : [row.material, row.colorName].filter(Boolean).join(' ') || null,
  }))
  // A request that names no filament still prints in something.
  if (filaments.length === 0 && request.filamentG != null) {
    filaments.push({ grams: request.filamentG, costPerGram: null, material: null })
  }

  const printer = await printerFor(db, request.id)
  const history = await successHistory(db, request.modelId, printer?.name ?? null)
  const customerTier = request.customerId
    ? (
        await db.execute<{ default_tier: string | null }>(sql`
          SELECT default_tier FROM customers WHERE id = ${request.customerId}`)
      ).rows[0]?.default_tier
    : null
  const tier = pickTier(pricing, request.pricingTier, customerTier)

  const quote = quotePrint(
    {
      filaments,
      printMin: request.estimatedMin,
      quantity: request.quantity,
      printer,
      successRate: history.rate,
    },
    pricing,
    tier,
  )
  return {
    ...quote,
    tier,
    successRate: history.rate ?? pricing.defaultSuccessRate,
    successFrom: history.from,
  }
}

/**
 * The printer whose rates apply: the one it is on, else the only printer
 * with rates of its own. Otherwise the settings' defaults stand in.
 */
async function printerFor(
  db: Database,
  requestId: string,
): Promise<{ name: string; watts: number | null; hourlyRate: number | null } | null> {
  const rows = await db.execute<{ name: string; watts: number | null; hourly_rate: string | null }>(
    sql`
    SELECT h.name, h.watts, h.hourly_rate FROM print_hosts h
    WHERE h.id = (SELECT pj.host_id FROM print_requests r
                  JOIN printer_jobs pj ON pj.id = r.printer_job_id WHERE r.id = ${requestId})
    UNION ALL
    SELECT name, watts, hourly_rate FROM print_hosts
    WHERE (watts IS NOT NULL OR hourly_rate IS NOT NULL)
      AND (SELECT count(*) FROM print_hosts WHERE watts IS NOT NULL OR hourly_rate IS NOT NULL) = 1
    LIMIT 1`,
  )
  const row = rows.rows[0]
  return row
    ? {
        name: row.name,
        watts: row.watts,
        hourlyRate: row.hourly_rate == null ? null : Number(row.hourly_rate),
      }
    : null
}

/** The model's own record when it has enough of one, else the printer's. */
async function successHistory(
  db: Database,
  modelId: string | null,
  printerName: string | null,
): Promise<{ rate: number | null; from: RequestQuote['successFrom'] }> {
  const rows = await db.execute<{
    scope: 'model' | 'printer'
    success: number
    partial: number
    failed: number
  }>(sql`
    SELECT 'model' AS scope,
           count(*) FILTER (WHERE status = 'success')::int AS success,
           count(*) FILTER (WHERE status = 'partial')::int AS partial,
           count(*) FILTER (WHERE status = 'failed')::int AS failed
    FROM print_runs WHERE ${modelId}::uuid IS NOT NULL AND model_id = ${modelId}::uuid
    UNION ALL
    SELECT 'printer',
           count(*) FILTER (WHERE status = 'success')::int,
           count(*) FILTER (WHERE status = 'partial')::int,
           count(*) FILTER (WHERE status = 'failed')::int
    FROM print_runs WHERE ${printerName}::text IS NOT NULL AND printer_name = ${printerName}::text`)
  const model = rows.rows.find((row) => row.scope === 'model')
  const printer = rows.rows.find((row) => row.scope === 'printer')
  const fromModel = model ? successRateFrom(model, 5) : null
  if (fromModel != null) return { rate: fromModel, from: 'model' }
  const fromPrinter = printer ? successRateFrom(printer, 10) : null
  if (fromPrinter != null) return { rate: fromPrinter, from: 'printer' }
  return { rate: null, from: 'default' }
}

/**
 * Gives the requester a price: worked out now, or typed in. A typed price is
 * kept as typed and never recomputed. Quoting again replaces an earlier quote
 * the requester has not paid for, and asks them to accept again.
 */
export async function quoteRequest(
  db: Database,
  requestId: string,
  pricing: PricingSettings,
  options: { manualPrice?: number | null; spoolman?: SpoolmanSpool[] | null } = {},
): Promise<RequestQuote> {
  const request = await getRequest(db, requestId)
  if (!request) throw new BillingError('That request is no longer in the queue.')
  if (request.priceStatus === 'invoiced' || request.priceStatus === 'paid') {
    throw new BillingError('It has been invoiced already. Its price stands.')
  }

  const quote = await priceRequest(db, request, pricing, options.spoolman ?? null)
  const manual = options.manualPrice != null
  if (manual && (!Number.isFinite(options.manualPrice) || options.manualPrice! < 0)) {
    throw new BillingError('That is not a price.')
  }
  if (!manual && quote.incomplete.length > 0 && quote.price <= 0) {
    throw new BillingError(`Cannot price it yet: ${quote.incomplete.join(', ')}.`)
  }
  const price = manual ? cents(options.manualPrice!) : quote.price
  const breakdown = manual ? scale(quote.split, quote.price, price) : quote.split

  await db.execute(sql`
    UPDATE print_requests
    SET price_status = 'quoted', quoted_price = ${price}, quoted_cost = ${quote.cost},
        quote_breakdown = ${JSON.stringify(breakdown)}::jsonb,
        quoted_at = now(), quote_expires_at = now() + make_interval(days => ${pricing.quoteValidDays}),
        accepted_at = NULL, declined_at = NULL, price_manual = ${manual},
        needs_requote = false, updated_at = now()
    WHERE id = ${requestId}`)
  return { ...quote, price }
}

/** A computed split, stretched to a typed price, still adding up to it. */
function scale(lines: Quote['split'], from: number, to: number): Quote['split'] {
  if (from <= 0 || lines.length === 0) return to > 0 ? [{ label: 'Total', amount: to }] : []
  const scaled = lines.map((line) => ({ ...line, amount: cents((line.amount * to) / from) }))
  const drift = cents(to - scaled.reduce((sum, line) => sum + line.amount, 0))
  scaled[scaled.length - 1]!.amount = cents(scaled[scaled.length - 1]!.amount + drift)
  return scaled
}

/**
 * Moves the price along by hand: the requester said yes on the phone, or the
 * print is on the house. `none` withdraws a quote that was never paid.
 */
export async function setPriceStatus(
  db: Database,
  requestId: string,
  next: Extract<PriceStatus, 'accepted' | 'declined' | 'waived' | 'none'>,
): Promise<void> {
  const allowed: Record<typeof next, PriceStatus[]> = {
    accepted: ['quoted', 'declined'],
    declined: ['quoted', 'accepted'],
    waived: ['none', 'quoted', 'accepted', 'declined', 'invoiced'],
    none: ['quoted', 'declined', 'waived', 'accepted'],
  }
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE print_requests
    SET price_status = ${next}::price_status,
        accepted_at = ${next === 'accepted' ? sql`now()` : next === 'none' ? sql`NULL` : sql`accepted_at`},
        declined_at = ${next === 'declined' ? sql`now()` : next === 'none' ? sql`NULL` : sql`declined_at`},
        ${
          next === 'none'
            ? sql`quoted_price = NULL, quoted_cost = NULL, quote_breakdown = NULL, quoted_at = NULL,
                  quote_expires_at = NULL, price_manual = false, needs_requote = false,`
            : sql``
        }
        updated_at = now()
    WHERE id = ${requestId}
      AND price_status = ANY(${sql.param(allowed[next])}::price_status[])
    RETURNING id`)
  if (rows.rows.length === 0) throw new BillingError('That is not a step its price can take now.')
}

/**
 * The requester's answer, from their status page. Only to a quote that still
 * stands: not expired, and not changed since it was given.
 */
export async function respondToQuote(
  db: Database,
  token: string,
  answer: 'accept' | 'decline',
): Promise<void> {
  if (!/^[0-9A-Za-z]{8,32}$/.test(token)) throw new BillingError('That link is not valid.')
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE print_requests
    SET price_status = ${answer === 'accept' ? 'accepted' : 'declined'}::price_status,
        ${answer === 'accept' ? sql`accepted_at = now()` : sql`declined_at = now()`},
        updated_at = now()
    WHERE share_token = ${token} AND price_status = 'quoted' AND NOT needs_requote
      AND (quote_expires_at IS NULL OR quote_expires_at > now())
      AND status <> 'cancelled'
    RETURNING id`)
  if (rows.rows.length === 0) {
    throw new BillingError('This quote can no longer be answered. Ask for a new one.')
  }
}

/** Whether the quote has run out, as of now. */
export function quoteExpired(
  request: Pick<PrintRequest, 'priceStatus' | 'quoteExpiresAt'>,
): boolean {
  return (
    request.priceStatus === 'quoted' &&
    request.quoteExpiresAt != null &&
    request.quoteExpiresAt.getTime() < Date.now()
  )
}

/* ------------------------------------------------------------------ *
 * Payments
 * ------------------------------------------------------------------ */

export type PaymentMethod = 'cash' | 'transfer' | 'paypal' | 'other'
export const PAYMENT_METHODS: readonly PaymentMethod[] = ['cash', 'transfer', 'paypal', 'other']

export interface Payment {
  id: string
  requestId: string
  amount: number
  method: PaymentMethod
  paidAt: Date
  note: string | null
}

export async function listPayments(db: Database, requestIds: string[]): Promise<Payment[]> {
  if (requestIds.length === 0) return []
  const rows = await db.execute<{
    id: string
    request_id: string
    amount: string
    method: PaymentMethod
    paid_at: string
    note: string | null
  }>(sql`
    SELECT id, request_id, amount, method, paid_at, note FROM request_payments
    WHERE request_id = ANY(${sql.param(requestIds)}::uuid[]) ORDER BY paid_at, created_at`)
  return rows.rows.map((row) => ({
    id: row.id,
    requestId: row.request_id,
    amount: Number(row.amount),
    method: row.method,
    paidAt: new Date(row.paid_at),
    note: row.note,
  }))
}

/** Records money received. Deposits and part payments are just smaller amounts. */
export async function addPayment(
  db: Database,
  requestId: string,
  input: { amount: number; method?: PaymentMethod; paidAt?: Date | null; note?: string | null },
  actorId: string | null = null,
): Promise<string> {
  const amount = Number(input.amount)
  // Negative is a refund, which is a payment going the other way.
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 1_000_000) {
    throw new BillingError('Enter the amount received.')
  }
  const method = input.method ?? 'cash'
  if (!PAYMENT_METHODS.includes(method)) throw new BillingError('That is not a payment method.')
  const rows = await db.execute<{ id: string }>(sql`
    INSERT INTO request_payments (request_id, amount, method, paid_at, note, created_by)
    SELECT id, ${cents(amount)}, ${method}::payment_method, coalesce(${input.paidAt ?? null}::timestamptz, now()),
           ${input.note?.trim().slice(0, 500) || null}, ${actorId}
    FROM print_requests WHERE id = ${requestId}
    RETURNING id`)
  if (rows.rows.length === 0) throw new BillingError('That request is no longer in the queue.')
  await settlePaid(db, requestId)
  return rows.rows[0]!.id
}

export async function deletePayment(db: Database, paymentId: string): Promise<void> {
  const rows = await db.execute<{ request_id: string }>(sql`
    DELETE FROM request_payments WHERE id = ${paymentId} RETURNING request_id`)
  const requestId = rows.rows[0]?.request_id
  if (requestId) await settlePaid(db, requestId)
}

/**
 * Paid in full is paid, whatever the step before — paying a quote is
 * accepting it. A payment taken back moves it back to what it was owed as.
 */
async function settlePaid(db: Database, requestId: string): Promise<void> {
  await db.execute(sql`
    UPDATE print_requests r
    SET price_status = CASE
          WHEN r.quoted_price IS NOT NULL AND p.paid >= r.quoted_price
               AND r.price_status IN ('quoted', 'accepted', 'invoiced') THEN 'paid'
          WHEN r.price_status = 'paid' AND (r.quoted_price IS NULL OR p.paid < r.quoted_price)
            THEN CASE WHEN r.invoice_id IS NOT NULL THEN 'invoiced' ELSE 'accepted' END
          ELSE r.price_status::text END::price_status,
        accepted_at = CASE WHEN r.price_status = 'quoted' AND p.paid >= r.quoted_price
                           THEN coalesce(r.accepted_at, now()) ELSE r.accepted_at END,
        updated_at = now()
    FROM (SELECT coalesce(sum(amount), 0) AS paid FROM request_payments WHERE request_id = ${requestId}) p
    WHERE r.id = ${requestId}`)
}

/* ------------------------------------------------------------------ *
 * Customers and what they owe
 * ------------------------------------------------------------------ */

export interface Customer {
  id: string
  name: string
  contact: string | null
  defaultTier: string | null
  notes: string | null
}

export interface CustomerInput {
  name: string
  contact?: string | null
  defaultTier?: string | null
  notes?: string | null
}

function cleanCustomer(input: CustomerInput) {
  const name = input.name?.trim()
  if (!name) throw new BillingError('A customer needs a name.')
  const tier = input.defaultTier?.trim() || null
  if (tier && !/^[a-z0-9-]{1,60}$/.test(tier)) throw new BillingError('That is not a tier.')
  return {
    name: name.slice(0, 120),
    contact: input.contact?.trim().slice(0, 500) || null,
    defaultTier: tier,
    notes: input.notes?.trim().slice(0, 5000) || null,
  }
}

export async function listCustomers(db: Database): Promise<Customer[]> {
  const rows = await db.execute<{
    id: string
    name: string
    contact: string | null
    default_tier: string | null
    notes: string | null
  }>(sql`SELECT id, name, contact, default_tier, notes FROM customers ORDER BY lower(name)`)
  return rows.rows.map((row) => ({
    id: row.id,
    name: row.name,
    contact: row.contact,
    defaultTier: row.default_tier,
    notes: row.notes,
  }))
}

/**
 * Adds a customer, and links the requests already raised under that name
 * (case aside) that have no customer yet — what turns "Tom" and "tom" into
 * one balance.
 */
export async function createCustomer(db: Database, input: CustomerInput): Promise<string> {
  const customer = cleanCustomer(input)
  try {
    const rows = await db.execute<{ id: string }>(sql`
      INSERT INTO customers (name, contact, default_tier, notes)
      VALUES (${customer.name}, ${customer.contact}, ${customer.defaultTier}, ${customer.notes})
      RETURNING id`)
    const id = rows.rows[0]!.id
    await db.execute(sql`
      UPDATE print_requests SET customer_id = ${id}
      WHERE customer_id IS NULL AND lower(trim(requested_by)) = lower(${customer.name})`)
    return id
  } catch (error) {
    if (isUniqueViolation(error)) throw new BillingError(`There is already a ${customer.name}.`)
    throw error
  }
}

export async function updateCustomer(
  db: Database,
  id: string,
  input: CustomerInput,
): Promise<void> {
  const customer = cleanCustomer(input)
  try {
    const rows = await db.execute(sql`
      UPDATE customers SET name = ${customer.name}, contact = ${customer.contact},
             default_tier = ${customer.defaultTier}, notes = ${customer.notes}, updated_at = now()
      WHERE id = ${id}`)
    if (rows.rowCount === 0) throw new BillingError('That customer no longer exists.')
  } catch (error) {
    if (isUniqueViolation(error)) throw new BillingError(`There is already a ${customer.name}.`)
    throw error
  }
}

/** Removes the customer; their requests keep the name they were raised under. */
export async function deleteCustomer(db: Database, id: string): Promise<void> {
  await db.execute(sql`DELETE FROM customers WHERE id = ${id}`)
}

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string }; code?: string }) ?? {}
  return cause.code === '23505' || cause.cause?.code === '23505'
}

export interface BalanceRequest {
  id: string
  title: string
  status: string
  priceStatus: PriceStatus
  price: number | null
  paid: number
  createdAt: Date
  invoiceNumber: number | null
}

export interface Balance {
  /** Null for requesters who are only a name. */
  customerId: string | null
  name: string
  /** Agreed prices: accepted, invoiced or paid. */
  owed: number
  paid: number
  /** Positive is still to pay; negative is credit. */
  balance: number
  requests: BalanceRequest[]
}

/**
 * Who owes what. Customers by id; everyone else by the name they asked
 * under, so a one-off asker still shows up — but as their own line, since
 * "Tom" might not be the Tom.
 *
 * A request counts once its price is agreed. A cancelled one counts only if
 * it was invoiced; a payment on anything counts, so a kept deposit is credit.
 */
export async function balances(
  db: Database,
  options: { openOnly?: boolean } = {},
): Promise<Balance[]> {
  const rows = await db.execute<{
    id: string
    title: string
    status: string
    price_status: PriceStatus
    quoted_price: string | null
    paid: string
    created_at: string
    invoice_number: number | null
    customer_id: string | null
    customer_name: string | null
    requested_by: string | null
  }>(sql`
    SELECT r.id, r.title, r.status, r.price_status, r.quoted_price, r.created_at,
           inv.number AS invoice_number, r.customer_id, c.name AS customer_name, r.requested_by,
           coalesce((SELECT sum(amount) FROM request_payments p WHERE p.request_id = r.id), 0) AS paid
    FROM print_requests r
    LEFT JOIN customers c ON c.id = r.customer_id
    LEFT JOIN invoices inv ON inv.id = r.invoice_id
    WHERE r.price_status = ANY(${sql.param(OWED_STATUSES)}::price_status[])
       OR EXISTS (SELECT 1 FROM request_payments p WHERE p.request_id = r.id)
    ORDER BY r.created_at`)

  const groups = new Map<string, Balance>()
  for (const row of rows.rows) {
    const name = row.customer_name ?? row.requested_by?.trim() ?? 'No name'
    const key = row.customer_id ?? `name:${name.toLowerCase()}`
    let group = groups.get(key)
    if (!group) {
      group = { customerId: row.customer_id, name, owed: 0, paid: 0, balance: 0, requests: [] }
      groups.set(key, group)
    }
    const counts =
      OWED_STATUSES.includes(row.price_status) &&
      (row.status !== 'cancelled' || row.price_status !== 'accepted')
    const price = row.quoted_price == null ? null : Number(row.quoted_price)
    if (counts && price != null) group.owed += price
    group.paid += Number(row.paid)
    group.requests.push({
      id: row.id,
      title: row.title,
      status: row.status,
      priceStatus: row.price_status,
      price,
      paid: Number(row.paid),
      createdAt: new Date(row.created_at),
      invoiceNumber: row.invoice_number,
    })
  }
  const list = [...groups.values()].map((group) => ({
    ...group,
    owed: cents(group.owed),
    paid: cents(group.paid),
    balance: cents(group.owed - group.paid),
  }))
  return list
    .filter((group) => !options.openOnly || Math.abs(group.balance) >= 0.01)
    .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name))
}

/* ------------------------------------------------------------------ *
 * Invoices
 * ------------------------------------------------------------------ */

export interface Invoice {
  id: string
  number: number
  customerId: string | null
  recipient: string | null
  requestIds: string[]
  lines: InvoiceLine[]
  total: number
  taxMode: PricingSettings['taxMode']
  taxRate: number | null
  currency: string
  issuedAt: Date
}

/**
 * Writes an invoice for one request or several (one customer's), numbered
 * from a gap-free sequence: the next number is taken under a lock, inside the
 * transaction that writes the invoice, so a failure leaves no hole and two at
 * once cannot share a number.
 */
export async function createInvoice(
  db: Database,
  input: { requestIds: string[]; recipient?: string | null },
  pricing: PricingSettings,
  actorId: string | null = null,
): Promise<Invoice> {
  const ids = [...new Set(input.requestIds)]
  if (ids.length === 0) throw new BillingError('Choose what the invoice is for.')
  if (ids.length > 100) throw new BillingError('That is too many for one invoice.')

  return db.transaction(async (tx) => {
    const rows = await tx.execute<{
      id: string
      title: string
      quantity: number
      quoted_price: string | null
      price_status: PriceStatus
      invoice_id: string | null
      customer_id: string | null
      customer_name: string | null
      requested_by: string | null
    }>(sql`
      SELECT r.id, r.title, r.quantity, r.quoted_price, r.price_status, r.invoice_id,
             r.customer_id, c.name AS customer_name, r.requested_by
      FROM print_requests r LEFT JOIN customers c ON c.id = r.customer_id
      WHERE r.id = ANY(${sql.param(ids)}::uuid[])
      ORDER BY r.created_at
      FOR UPDATE OF r`)
    if (rows.rows.length !== ids.length)
      throw new BillingError('A request has gone from the queue.')
    for (const row of rows.rows) {
      if (row.quoted_price == null || !['accepted', 'paid'].includes(row.price_status)) {
        throw new BillingError(`"${row.title}" has no agreed price to invoice.`)
      }
      if (row.invoice_id) throw new BillingError(`"${row.title}" is on an invoice already.`)
    }
    // The same grouping as `balances`: a customer, else the name, case aside.
    const customers = new Set(
      rows.rows.map(
        (row) => row.customer_id ?? `name:${row.requested_by?.trim().toLowerCase() ?? ''}`,
      ),
    )
    if (customers.size > 1) throw new BillingError('One invoice is for one customer.')

    const lines: InvoiceLine[] = rows.rows.map((row) => ({
      requestId: row.id,
      title: row.title,
      quantity: row.quantity,
      unitPrice: cents(Number(row.quoted_price) / row.quantity),
      total: Number(row.quoted_price),
    }))
    const total = cents(lines.reduce((sum, line) => sum + line.total, 0))
    const first = rows.rows[0]!
    const recipient =
      input.recipient?.trim().slice(0, 500) || first.customer_name || first.requested_by || null

    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('printbench:invoice-number'))`)
    const next = await tx.execute<{ number: number }>(
      sql`SELECT coalesce(max(number), 0) + 1 AS number FROM invoices`,
    )
    const number = next.rows[0]!.number

    const inserted = await tx.execute<{ id: string; issued_at: string }>(sql`
      INSERT INTO invoices
        (number, customer_id, recipient, request_ids, lines, total, tax_mode, tax_rate, currency, created_by)
      VALUES (${number}, ${first.customer_id}, ${recipient}, ${sql.param(ids)}::uuid[],
              ${JSON.stringify(lines)}::jsonb, ${total}, ${pricing.taxMode},
              ${pricing.taxMode === 'vat' ? pricing.taxRate : null}, ${pricing.currency}, ${actorId})
      RETURNING id, issued_at`)
    const id = inserted.rows[0]!.id
    await tx.execute(sql`
      UPDATE print_requests
      SET invoice_id = ${id},
          price_status = CASE WHEN price_status = 'accepted' THEN 'invoiced' ELSE price_status::text END::price_status,
          updated_at = now()
      WHERE id = ANY(${sql.param(ids)}::uuid[])`)

    return {
      id,
      number,
      customerId: first.customer_id,
      recipient,
      requestIds: ids,
      lines,
      total,
      taxMode: pricing.taxMode,
      taxRate: pricing.taxMode === 'vat' ? pricing.taxRate : null,
      currency: pricing.currency,
      issuedAt: new Date(inserted.rows[0]!.issued_at),
    }
  })
}

type InvoiceRow = {
  id: string
  number: number
  customer_id: string | null
  recipient: string | null
  request_ids: string[]
  lines: InvoiceLine[]
  total: string
  tax_mode: PricingSettings['taxMode']
  tax_rate: string | null
  currency: string
  issued_at: string
}

function toInvoice(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    number: row.number,
    customerId: row.customer_id,
    recipient: row.recipient,
    requestIds: row.request_ids,
    lines: row.lines,
    total: Number(row.total),
    taxMode: row.tax_mode,
    taxRate: row.tax_rate == null ? null : Number(row.tax_rate),
    currency: row.currency,
    issuedAt: new Date(row.issued_at),
  }
}

export async function getInvoice(db: Database, id: string): Promise<Invoice | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const rows = await db.execute<InvoiceRow>(sql`SELECT * FROM invoices WHERE id = ${id}`)
  return rows.rows[0] ? toInvoice(rows.rows[0]) : null
}

export async function listInvoices(db: Database, limit = 100): Promise<Invoice[]> {
  const rows = await db.execute<InvoiceRow>(
    sql`SELECT * FROM invoices ORDER BY number DESC LIMIT ${Math.min(Math.max(limit, 1), 500)}`,
  )
  return rows.rows.map(toInvoice)
}

/**
 * The invoice as a PDF: number, date, items, quantity, unit price, total,
 * amount paid and balance, with the seller's details and the tax wording its
 * tax mode requires.
 */
export function invoicePdf(
  invoice: Invoice,
  seller: PricingSettings['seller'],
  paid: number,
): Uint8Array {
  const money = (amount: number) => formatMoney(amount, invoice.currency, 'de-DE')
  const items: PdfItem[] = []
  const left = 56
  const right = PAGE_WIDTH - 56
  let y = 64

  const text = (
    value: string,
    x: number,
    options: { size?: number; bold?: boolean; align?: 'left' | 'right'; muted?: boolean } = {},
  ) => items.push({ kind: 'text', x, y, size: options.size ?? 10, text: value, ...options })

  if (seller.name) text(seller.name, left, { size: 12, bold: true })
  y += 14
  for (const line of seller.address.split(/\r?\n/).filter(Boolean)) {
    text(line, left, { size: 9, muted: true })
    y += 12
  }

  y = Math.max(y + 24, 140)
  text(paid >= invoice.total - 0.005 ? 'Receipt' : 'Invoice', left, { size: 20, bold: true })
  text(`No. ${invoice.number}`, right, { size: 11, bold: true, align: 'right' })
  y += 16
  text(invoice.issuedAt.toISOString().slice(0, 10), right, {
    size: 10,
    align: 'right',
    muted: true,
  })
  if (invoice.recipient) {
    text('For', left, { size: 9, muted: true })
    y += 13
    for (const line of invoice.recipient.split(/\r?\n/)) {
      text(line, left)
      y += 13
    }
  }

  y += 24
  const qtyX = right - 190
  const unitX = right - 95
  text('Item', left, { size: 9, bold: true })
  text('Qty', qtyX, { size: 9, bold: true, align: 'right' })
  text('Unit price', unitX, { size: 9, bold: true, align: 'right' })
  text('Total', right, { size: 9, bold: true, align: 'right' })
  y += 6
  items.push({ kind: 'line', x1: left, y1: y, x2: right, y2: y })
  y += 16

  for (const line of invoice.lines) {
    const wrapped = wrapText(line.title, 10, qtyX - left - 40)
    text(wrapped[0] ?? '', left)
    text(String(line.quantity), qtyX, { align: 'right' })
    text(money(line.unitPrice), unitX, { align: 'right' })
    text(money(line.total), right, { align: 'right' })
    for (const more of wrapped.slice(1)) {
      y += 13
      text(more, left)
    }
    y += 18
  }

  items.push({ kind: 'line', x1: left, y1: y - 8, x2: right, y2: y - 8 })
  y += 8
  const sum = (label: string, amount: number, bold = false) => {
    text(label, unitX, { align: 'right', bold })
    text(money(amount), right, { align: 'right', bold })
    y += 16
  }
  if (invoice.taxMode === 'vat' && invoice.taxRate != null) {
    const net = cents(invoice.total / (1 + invoice.taxRate / 100))
    sum('Net', net)
    sum(`VAT ${invoice.taxRate} %`, cents(invoice.total - net))
  }
  sum('Total', invoice.total, true)
  if (paid !== 0) {
    sum('Paid', paid)
    sum('Balance', cents(invoice.total - paid), true)
  }

  y += 20
  if (invoice.taxMode === 'small-business-note') {
    text('Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.', left, { size: 9 })
    y += 12
    text('No VAT is charged under the small-business rule (§ 19 UStG).', left, {
      size: 8,
      muted: true,
    })
    y += 20
  }
  if (seller.paymentNote && paid < invoice.total - 0.005) {
    for (const line of wrapText(seller.paymentNote, 9, right - left)) {
      text(line, left, { size: 9 })
      y += 12
    }
  }

  return renderPdf(
    [items],
    `${paid >= invoice.total - 0.005 ? 'Receipt' : 'Invoice'} ${invoice.number}`,
  )
}

/* ------------------------------------------------------------------ *
 * Looking back, and looking ahead
 * ------------------------------------------------------------------ */

export interface ActualCost {
  /** What the prints behind it really cost, failures included. */
  cost: number
  runs: number
  failed: number
}

/**
 * What a request really cost, from its print runs: the real grams and
 * duration of every attempt, failed ones included. Set against the quoted
 * cost, it says whether the failure allowance is right.
 */
export async function actualCost(
  db: Database,
  request: PrintRequest,
  pricing: PricingSettings,
): Promise<ActualCost | null> {
  const rows = await db.execute<{
    status: string
    duration_min: number | null
    filament_used_g: string | null
    usage_cost: string | null
    usage_grams: string | null
    watts: number | null
    hourly_rate: string | null
  }>(sql`
    SELECT p.status, p.duration_min, p.filament_used_g,
           (SELECT sum(u.grams * u.cost_per_gram) FROM print_filament_usage u
             WHERE u.print_run_id = p.id) AS usage_cost,
           (SELECT sum(u.grams) FROM print_filament_usage u WHERE u.print_run_id = p.id) AS usage_grams,
           h.watts, h.hourly_rate
    FROM print_runs p
    LEFT JOIN print_hosts h ON h.name = p.printer_name
    WHERE p.id IN (SELECT print_run_id FROM printer_jobs WHERE request_id = ${request.id}
                   UNION SELECT print_run_id FROM print_requests WHERE id = ${request.id})`)
  if (rows.rows.length === 0) return null

  const material = request.filaments[0]?.material ?? null
  const fallbackPerGram = (() => {
    const tier = pickTier(pricing)
    const sample = quotePrint(
      {
        filaments: [{ grams: 1000, costPerGram: null, material }],
        printMin: null,
        quantity: 1,
        printer: null,
        successRate: 1,
      },
      { ...pricing, defaultWatts: null, defaultHourlyRate: null },
      tier,
    )
    return (sample.costLines[0]?.amount ?? 0) / 1000
  })()

  let cost = 0
  for (const row of rows.rows) {
    const usageGrams = Number(row.usage_grams ?? 0)
    const allGrams = Number(row.filament_used_g ?? 0)
    cost += Number(row.usage_cost ?? 0) + Math.max(0, allGrams - usageGrams) * fallbackPerGram
    const hours = (row.duration_min ?? 0) / 60
    const watts = row.watts ?? pricing.defaultWatts
    const rate = row.hourly_rate != null ? Number(row.hourly_rate) : pricing.defaultHourlyRate
    if (watts) cost += hours * (watts / 1000) * pricing.kwhPrice
    if (rate) cost += hours * rate
  }
  return {
    cost: cents(cost),
    runs: rows.rows.length,
    failed: rows.rows.filter((row) => row.status === 'failed').length,
  }
}

export interface ModelPriceEstimate {
  /** Cheapest and dearest of its sliced plates, at the default tier. */
  min: number
  max: number
  plates: number
  tier: string
}

/**
 * "≈ €3.20 to print", for a model with sliced files: one copy of each plate
 * at the default tier, from the files' own figures: their stored reads, or
 * the two ends of a file the job has not read yet. At most a few files.
 */
export async function modelPriceEstimate(
  db: Database,
  modelId: string,
  pricing: PricingSettings,
): Promise<ModelPriceEstimate | null> {
  if (!pricing.enabled) return null
  const files = await db
    .select({
      filename: schema.modelFiles.filename,
      extension: schema.modelFiles.extension,
      size: schema.modelFiles.size,
      slicerMeta: schema.modelFiles.slicerMeta,
      slicerMetaVersion: schema.modelFiles.slicerMetaVersion,
      model: schema.models,
      library: schema.libraries,
    })
    .from(schema.modelFiles)
    .innerJoin(schema.models, eq(schema.models.id, schema.modelFiles.modelId))
    .innerJoin(schema.libraries, eq(schema.libraries.id, schema.models.libraryId))
    .where(
      and(
        eq(schema.modelFiles.modelId, modelId),
        isNull(schema.modelFiles.missingAt),
        eq(schema.modelFiles.category, 'slicer'),
      ),
    )
    .orderBy(schema.modelFiles.filename)
    .limit(6)
  const tier = pickTier(pricing)
  const prices: number[] = []
  for (const file of files.filter((row) => isParsableSlicerFile(row.extension)).slice(0, 3)) {
    try {
      const metadata =
        storedSlicerMeta(file) ??
        (await readGcodeMetadata(
          createStorageAdapter(libraryLocationFromRow(file.library)),
          file.model.isFileModel ? file.model.path : `${file.model.path}/${file.filename}`,
          file.size,
        ))
      const tools = (metadata.filaments ?? []).filter((tool) => tool.used)
      const filaments: QuoteFilament[] =
        tools.length > 0 && tools.every((tool) => tool.grams != null)
          ? tools.map((tool) => ({ grams: tool.grams, costPerGram: null, material: tool.material }))
          : [
              {
                grams: metadata.filamentUsedG ?? null,
                costPerGram: null,
                material: metadata.material ?? null,
              },
            ]
      const quote = quotePrint(
        { filaments, printMin: metadata.durationMin ?? null, quantity: 1, printer: null },
        pricing,
        tier,
      )
      if (quote.incomplete.length === 0) prices.push(quote.price)
    } catch {
      // A file that cannot be read has no price; the others still do.
    }
  }
  if (prices.length === 0) return null
  return {
    min: Math.min(...prices),
    max: Math.max(...prices),
    plates: prices.length,
    tier: tier.label,
  }
}
