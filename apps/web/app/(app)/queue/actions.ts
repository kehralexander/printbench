'use server'

import { revalidatePath } from 'next/cache'
import {
  BillingError,
  PolicyError,
  RequestValidationError,
  actualCost,
  addPayment,
  assertCan,
  createInvoice,
  deletePayment,
  getSettings,
  listPayments,
  listSpoolmanSpools,
  plateFilaments,
  priceRequest,
  quoteRequest,
  setPriceStatus,
  spoolmanEnabled,
  type ActualCost,
  type GcodeTool,
  type Payment,
  type PaymentMethod,
  type RequestFilamentInput,
  type RequestQuote,
  can,
  canSendToPrinter,
  clearQueueOrder,
  reorderRequests,
  requestShareToken,
  createRequest,
  decryptSecret,
  createRequests,
  deleteRequest,
  getRequest,
  linkRequest,
  parseRequestLines,
  quickSearch,
  readPrinterStatus,
  setRequestStatus,
  suggestEstimate,
  updateRequest,
  type EstimateSuggestion,
  type PrintRequest,
  type PrintRequestPriority,
  type PrintRequestStatus,
  type RequestPatch,
  type SlotAssignment,
} from '@pb/core'
import { requireUser } from '@pb/auth'
import { getDb, schema } from '@pb/db'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { audit } from '@/lib/audit'
import { sendFileToPrinter, type SendResult } from '../models/[publicId]/send-actions'

type Result = { ok: true } | { ok: false; error: string }

type AddResult =
  | { ok: true; created: number; autoLinked: number; skipped: string[] }
  | { ok: false; error: string }

/**
 * Two levels of write.
 *
 * `edit` is the author's own request — their wording, their quantity, and
 * their decision to call it off. `run` is working the queue: starting
 * something and marking it done, which is a claim about the printer and
 * belongs to whoever is standing at it.
 */
type Need = 'edit' | 'run'

type Authorized =
  | { ok: false; error: string }
  | { ok: true; user: { id: string; name?: string | null }; request: PrintRequest }

async function authorize(requestId: string, need: Need): Promise<Authorized> {
  const user = await requireUser()
  const policyUser = { id: user.id, role: user.role ?? null, banned: user.banned ?? false }

  const request = await getRequest(getDb(), requestId)
  if (!request) return { ok: false, error: 'That request is no longer in the queue.' }

  const manager = can(policyUser, 'request:manage')
  if (!manager && (need === 'run' || request.createdBy !== user.id)) {
    throw new PolicyError('request:manage')
  }

  return { ok: true, user, request }
}

/**
 * Adds a whole message at once.
 *
 * The bulk box is the reason this feature exists: requests arrive as "the
 * dragon, two cable clips and a phone stand", and retyping that into six
 * separate forms is exactly the friction that keeps the list on a sticky note.
 */
export async function addRequests(input: {
  text: string
  requestedBy?: string | null
  priority?: PrintRequestPriority | null
  dueAt?: string | null
  notes?: string | null
  filaments?: RequestFilamentInput[] | null
}): Promise<AddResult> {
  try {
    const user = await requireUser()
    assertCan(
      { id: user.id, role: user.role ?? null, banned: user.banned ?? false },
      'request:create',
    )

    const lines = parseRequestLines(input.text)
    if (lines.length === 0) return { ok: false, error: 'Type at least one thing to print.' }

    const requestedBy = input.requestedBy?.trim() || null

    const result = await createRequests(
      getDb(),
      lines.map((line) => ({
        title: line.title,
        quantity: line.quantity,
        requestedBy,
        /*
         * Link the row to the asker's account only when they are asking for
         * themselves. Typing someone else's name in the box does not make the
         * request theirs.
         */
        requestedByUserId: requestedBy === null || requestedBy === user.name ? user.id : null,
        priority: input.priority ?? 'normal',
        notes: input.notes ?? null,
        filaments: input.filaments ?? null,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
      })),
      user.id,
    )

    if (result.created > 0) {
      await audit(
        user,
        'request.created',
        { type: 'request', label: lines[0]!.title },
        {
          requests: result.created,
          requestedFor: requestedBy ?? undefined,
        },
      )
    }

    revalidatePath('/queue')
    revalidatePath('/')

    return {
      ok: true,
      created: result.created,
      autoLinked: result.autoLinked,
      skipped: result.failed.map((failure) => failure.title),
    }
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not add those to the queue.') }
  }
}

/** Queues one model straight from its own page. */
export async function addModelToQueue(input: {
  modelId: string
  modelPublicId: string
  title: string
  quantity?: number
  requestedBy?: string | null
  notes?: string | null
  filaments?: RequestFilamentInput[] | null
  modelFileId?: string | null
  /** Minutes per print; omitted lets the queue suggest one. */
  estimatedMin?: number | null
}): Promise<Result> {
  try {
    const user = await requireUser()
    assertCan(
      { id: user.id, role: user.role ?? null, banned: user.banned ?? false },
      'request:create',
    )

    const requestedBy = input.requestedBy?.trim() || null

    await createRequest(
      getDb(),
      {
        title: input.title,
        modelId: input.modelId,
        modelFileId: input.modelFileId ?? null,
        quantity: input.quantity ?? 1,
        notes: input.notes ?? null,
        filaments: input.filaments ?? null,
        estimatedMin: input.estimatedMin,
        requestedBy,
        requestedByUserId: requestedBy === null || requestedBy === user.name ? user.id : null,
      },
      user.id,
    )
    await audit(
      user,
      'request.created',
      { type: 'request', label: input.title },
      {
        quantity: input.quantity ?? 1,
        requestedFor: requestedBy ?? undefined,
      },
    )

    revalidatePath('/queue')
    revalidatePath('/')
    revalidatePath(`/models/${input.modelPublicId}`)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not add that to the queue.') }
  }
}

export async function setStatus(requestId: string, status: PrintRequestStatus): Promise<Result> {
  try {
    // Starting or finishing a print is a claim about the printer; cancelling
    // and reopening are things the person who asked may do to their own.
    const need: Need = status === 'printing' || status === 'done' ? 'run' : 'edit'

    const authorized = await authorize(requestId, need)
    if (!authorized.ok) return authorized

    /*
     * The user is passed through so a print logged from here is attributed to
     * whoever marked it printed, exactly as it would be from the model page.
     */
    await setRequestStatus(getDb(), requestId, status, { userId: authorized.user.id })
    await audit(
      authorized.user,
      status === 'done' ? 'request.completed' : 'request.status_changed',
      { type: 'request', id: requestId, label: authorized.request.title },
      { from: authorized.request.status, to: status },
    )
    revalidateFor(authorized.request)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not update that request.') }
  }
}

/**
 * Sends a request's sliced file to a printer and starts it, then puts the
 * request on the printer.
 *
 * Asks the printer first rather than trusting the worker's last reading: an
 * upload with "start" to a printer mid-print is refused at best, and queued
 * behind the running job at worst, and either is better said before sending.
 */
export async function sendRequestToPrinter(
  requestId: string,
  hostId: string,
  /** Slots picked by hand, when a KX-Bridge send asked for them. */
  slots?: SlotAssignment[],
): Promise<SendResult> {
  try {
    const authorized = await authorize(requestId, 'run')
    if (!authorized.ok) return authorized
    const { request, user } = authorized

    if (!request.modelFileId || !request.filename) {
      return { ok: false, error: 'Choose the sliced file to print first.' }
    }
    const extension = request.filename.split('.').pop() ?? ''
    if (!canSendToPrinter(extension)) {
      return { ok: false, error: 'Only a sliced file can be sent. Choose the G-code to print.' }
    }

    const [host] = await getDb()
      .select()
      .from(schema.printHosts)
      .where(eq(schema.printHosts.id, hostId))
      .limit(1)
    if (!host) return { ok: false, error: 'That printer is no longer configured.' }

    const status = await readPrinterStatus({
      id: host.id,
      name: host.name,
      protocol: host.protocol,
      endpoint: host.endpoint,
      apiKey: decryptSecret(host.credentials),
    })
    if (status.state === 'offline') {
      return { ok: false, error: `${host.name} is not answering. ${status.message ?? ''}`.trim() }
    }
    if (status.busy) {
      const what = status.filename ? status.filename.split('/').pop() : 'something else'
      return { ok: false, error: `${host.name} is busy printing ${what}.` }
    }

    const sent = await sendFileToPrinter(request.modelFileId, host.id, true, {
      slots,
      // Each tool by the request's filament for it.
      wanted: request.filaments,
    })
    if (!sent.ok) return sent

    if (request.status !== 'printing') {
      await setRequestStatus(getDb(), requestId, 'printing', { userId: user.id })
      await audit(
        user,
        'request.status_changed',
        { type: 'request', id: requestId, label: request.title },
        { from: request.status, to: 'printing', printer: host.name },
      )
    }
    revalidateFor(request)
    return { ok: true, message: sent.message }
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not send that to the printer.') }
  }
}

export async function editRequest(requestId: string, patch: RequestPatch): Promise<Result> {
  try {
    const authorized = await authorize(requestId, 'edit')
    if (!authorized.ok) return authorized

    // Who pays and at what rate is the charger's call, not the asker's.
    const user = authorized.user as { id: string; role?: string | null; banned?: boolean | null }
    if (
      (patch.customerId !== undefined || patch.pricingTier !== undefined) &&
      !can({ id: user.id, role: user.role ?? null, banned: user.banned ?? false }, 'billing:manage')
    ) {
      delete patch.customerId
      delete patch.pricingTier
    }

    await updateRequest(getDb(), requestId, patch)
    await audit(
      authorized.user,
      'request.updated',
      {
        type: 'request',
        id: requestId,
        label: authorized.request.title,
      },
      { changed: Object.keys(patch).join(', ') },
    )
    revalidateFor(authorized.request)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not save that change.') }
  }
}

/** Points a request at a model in the library, or clears the link. */
export async function setRequestModel(
  requestId: string,
  modelId: string | null,
  modelFileId: string | null = null,
): Promise<Result> {
  try {
    const authorized = await authorize(requestId, 'edit')
    if (!authorized.ok) return authorized

    await linkRequest(getDb(), requestId, modelId, modelFileId)

    /*
     * Both ends of the link move: the model page shows what is queued against
     * it, so the model it just left and the one it just joined are each stale.
     */
    revalidateFor(authorized.request)
    if (modelId) revalidateFor((await getRequest(getDb(), requestId)) ?? authorized.request)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not link that request.') }
  }
}

export async function removeRequest(requestId: string): Promise<Result> {
  try {
    const authorized = await authorize(requestId, 'edit')
    if (!authorized.ok) return authorized

    await deleteRequest(getDb(), requestId)
    await audit(authorized.user, 'request.deleted', {
      type: 'request',
      id: requestId,
      label: authorized.request.title,
    })
    revalidateFor(authorized.request)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not remove that request.') }
  }
}

/** Puts the open queue in the order it was dragged into. */
export async function reorderQueue(orderedIds: string[]): Promise<Result> {
  try {
    const user = await requireUser()
    assertCan(
      { id: user.id, role: user.role ?? null, banned: user.banned ?? false },
      'request:manage',
    )
    if (!Array.isArray(orderedIds) || orderedIds.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) {
      return { ok: false, error: 'That order did not make sense.' }
    }
    await reorderRequests(getDb(), orderedIds)
    await audit(user, 'request.reordered', undefined, { count: orderedIds.length })
    revalidatePath('/queue')
    revalidatePath('/')
    return { ok: true }
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not reorder the queue.') }
  }
}

/** Forgets the dragged order: priority, due date and age decide again. */
export async function resetQueueOrder(): Promise<Result> {
  try {
    const user = await requireUser()
    assertCan(
      { id: user.id, role: user.role ?? null, banned: user.banned ?? false },
      'request:manage',
    )
    await clearQueueOrder(getDb())
    await audit(user, 'request.reordered', undefined, { reset: true })
    revalidatePath('/queue')
    revalidatePath('/')
    return { ok: true }
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not reset the order.') }
  }
}

/** The request's status link for whoever asked for it, made on first use. */
export async function shareRequestStatus(
  requestId: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  try {
    const authorized = await authorize(requestId, 'edit')
    if (!authorized.ok) return authorized
    const fresh = !authorized.request.shareToken
    const token = await requestShareToken(getDb(), requestId)
    if (fresh) {
      await audit(authorized.user, 'request.shared', {
        type: 'request',
        id: requestId,
        label: authorized.request.title,
      })
    }
    return { ok: true, path: `/r/${token}` }
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not make a link for that request.') }
  }
}

/**
 * A suggested print time for one print of a model (or one of its files), to
 * pre-fill an estimate the user can still change. Null when there is nothing
 * to go on.
 */
export async function estimateFor(
  modelId: string,
  modelFileId: string | null = null,
): Promise<EstimateSuggestion | null> {
  try {
    const user = await requireUser()
    assertCan(
      { id: user.id, role: user.role ?? null, banned: user.banned ?? false },
      'request:create',
    )
    return await suggestEstimate(getDb(), modelId, modelFileId)
  } catch {
    return null
  }
}

export interface PrintableFile {
  id: string
  filename: string
  /** "slicer" files are sliced plates; "model" files still need slicing. */
  category: 'model' | 'slicer'
}

/** The files a request could point at: meshes and sliced plates, never images. */
export async function printableFiles(modelId: string): Promise<PrintableFile[]> {
  const user = await requireUser()
  assertCan({ id: user.id, role: user.role ?? null, banned: user.banned ?? false }, 'model:view')

  const rows = await getDb()
    .select({
      id: schema.modelFiles.id,
      filename: schema.modelFiles.filename,
      category: schema.modelFiles.category,
    })
    .from(schema.modelFiles)
    .where(
      and(
        eq(schema.modelFiles.modelId, modelId),
        isNull(schema.modelFiles.missingAt),
        inArray(schema.modelFiles.category, ['model', 'slicer']),
      ),
    )
    .orderBy(schema.modelFiles.category, schema.modelFiles.filename)

  return rows.map((row) => ({
    id: row.id,
    filename: row.filename,
    category: row.category as PrintableFile['category'],
  }))
}

export interface ModelChoice {
  id: string
  publicId: string | null
  name: string
  libraryName: string | null
}

/**
 * Models matching what someone typed into the link picker.
 *
 * Reuses the command palette's search rather than adding a second one: it is
 * already tuned for a few characters typed quickly, and a private search that
 * ranked differently from the visible one would be its own small bug.
 */
export async function findModels(query: string): Promise<ModelChoice[]> {
  const user = await requireUser()
  assertCan({ id: user.id, role: user.role ?? null, banned: user.banned ?? false }, 'model:view')

  if (query.trim().length === 0) return []

  const hits = await quickSearch(getDb(), query, 20)

  return hits
    .filter((hit) => hit.kind === 'model')
    .slice(0, 8)
    .map((hit) => ({
      id: hit.id,
      publicId: hit.publicId,
      name: hit.label,
      libraryName: hit.detail,
    }))
}

/**
 * The filaments of a file, for the editor to fill its rows in from when one
 * is chosen. Reads the whole file to see which tools it really uses.
 */
export async function filamentsForFile(
  modelId: string,
  modelFileId: string | null,
): Promise<{ tools: GcodeTool[] | null; durationMin: number | null }> {
  try {
    const user = await requireUser()
    assertCan(
      { id: user.id, role: user.role ?? null, banned: user.banned ?? false },
      'request:create',
    )
    return await plateFilaments(getDb(), modelId, modelFileId)
  } catch {
    return { tools: null, durationMin: null }
  }
}

/* ------------------------------------------------------------------ *
 * The money side of a request
 * ------------------------------------------------------------------ */

async function authorizeBilling(requestId: string): Promise<Authorized> {
  const user = await requireUser()
  assertCan(
    { id: user.id, role: user.role ?? null, banned: user.banned ?? false },
    'billing:manage',
  )
  const request = await getRequest(getDb(), requestId)
  if (!request) return { ok: false, error: 'That request is no longer in the queue.' }
  return { ok: true, user, request }
}

async function spoolmanList() {
  if (!spoolmanEnabled()) return null
  const result = await listSpoolmanSpools()
  return result.ok ? result.spools : null
}

export interface RequestPricing {
  /** What it would be quoted at now. */
  quote: RequestQuote
  /** What its prints really cost so far, once there are any. */
  actual: ActualCost | null
  payments: Payment[]
}

/** Everything the editor's price panel shows: a live quote, the real cost and payments. */
export async function requestPricing(
  requestId: string,
): Promise<{ ok: true; pricing: RequestPricing } | { ok: false; error: string }> {
  try {
    const authorized = await authorizeBilling(requestId)
    if (!authorized.ok) return authorized
    const db = getDb()
    const { pricing } = await getSettings(db)
    if (!pricing.enabled) return { ok: false, error: 'Pricing is switched off.' }
    const [quote, actual, payments] = await Promise.all([
      priceRequest(db, authorized.request, pricing, await spoolmanList()),
      actualCost(db, authorized.request, pricing),
      listPayments(db, [requestId]),
    ])
    return { ok: true, pricing: { quote, actual, payments } }
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not work out a price.') }
  }
}

/** Quotes the request: the worked-out price, or a typed one that is kept as typed. */
export async function quoteForRequest(
  requestId: string,
  manualPrice: number | null = null,
): Promise<Result> {
  try {
    const authorized = await authorizeBilling(requestId)
    if (!authorized.ok) return authorized
    const db = getDb()
    const { pricing } = await getSettings(db)
    if (!pricing.enabled) return { ok: false, error: 'Pricing is switched off.' }
    const quote = await quoteRequest(db, requestId, pricing, {
      manualPrice,
      spoolman: await spoolmanList(),
    })
    await audit(
      authorized.user,
      'request.quoted',
      { type: 'request', id: requestId, label: authorized.request.title },
      { price: quote.price, manual: manualPrice != null },
    )
    revalidateFor(authorized.request)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not quote that request.') }
  }
}

/** Accepted on the requester's behalf, declined, waived, or the quote withdrawn. */
export async function setRequestPriceStatus(
  requestId: string,
  status: 'accepted' | 'declined' | 'waived' | 'none',
): Promise<Result> {
  try {
    const authorized = await authorizeBilling(requestId)
    if (!authorized.ok) return authorized
    await setPriceStatus(getDb(), requestId, status)
    await audit(
      authorized.user,
      'request.price_status',
      { type: 'request', id: requestId, label: authorized.request.title },
      { from: authorized.request.priceStatus, to: status },
    )
    revalidateFor(authorized.request)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not change that.') }
  }
}

export async function recordPayment(
  requestId: string,
  input: { amount: number; method: PaymentMethod; paidAt?: string | null; note?: string | null },
): Promise<Result> {
  try {
    const authorized = await authorizeBilling(requestId)
    if (!authorized.ok) return authorized
    await addPayment(
      getDb(),
      requestId,
      {
        amount: input.amount,
        method: input.method,
        paidAt: input.paidAt ? new Date(input.paidAt) : null,
        note: input.note ?? null,
      },
      authorized.user.id,
    )
    await audit(
      authorized.user,
      'request.payment_recorded',
      { type: 'request', id: requestId, label: authorized.request.title },
      { amount: input.amount, method: input.method },
    )
    revalidateFor(authorized.request)
    revalidatePath('/billing')
    return { ok: true }
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not record that payment.') }
  }
}

export async function removePayment(requestId: string, paymentId: string): Promise<Result> {
  try {
    const authorized = await authorizeBilling(requestId)
    if (!authorized.ok) return authorized
    const payments = await listPayments(getDb(), [requestId])
    if (!payments.some((payment) => payment.id === paymentId)) {
      return { ok: false, error: 'That payment is not on this request.' }
    }
    await deletePayment(getDb(), paymentId)
    await audit(authorized.user, 'request.payment_removed', {
      type: 'request',
      id: requestId,
      label: authorized.request.title,
    })
    revalidateFor(authorized.request)
    revalidatePath('/billing')
    return { ok: true }
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not remove that payment.') }
  }
}

/** A receipt or invoice for this one request; several at once are on the billing page. */
export async function invoiceRequest(
  requestId: string,
): Promise<{ ok: true; invoiceId: string } | { ok: false; error: string }> {
  try {
    const authorized = await authorizeBilling(requestId)
    if (!authorized.ok) return authorized
    const db = getDb()
    const { pricing } = await getSettings(db)
    const invoice = await createInvoice(
      db,
      { requestIds: [requestId] },
      pricing,
      authorized.user.id,
    )
    await audit(
      authorized.user,
      'invoice.created',
      { type: 'request', id: requestId, label: authorized.request.title },
      { number: invoice.number, total: invoice.total },
    )
    revalidateFor(authorized.request)
    revalidatePath('/billing')
    return { ok: true, invoiceId: invoice.id }
  } catch (error) {
    return { ok: false, error: describe(error, 'Could not write the invoice.') }
  }
}

function revalidateFor(request: PrintRequest) {
  revalidatePath('/queue')
  revalidatePath('/')
  // Marking a linked request printed writes to the print history, so the log
  // and the model's own print list are both stale afterwards.
  revalidatePath('/prints')
  if (request.modelPublicId) revalidatePath(`/models/${request.modelPublicId}`)
}

function describe(error: unknown, fallback: string): string {
  if (error instanceof RequestValidationError || error instanceof BillingError) return error.message
  if (error instanceof PolicyError) return 'Not permitted.'
  console.error('[queue]', error)
  return fallback
}
