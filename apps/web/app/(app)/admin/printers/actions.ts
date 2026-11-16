'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import {
  PolicyError,
  assertCan,
  decryptSecret,
  encryptSecret,
  isValidEndpoint,
  probeHost,
  type PrintHostProtocol,
} from '@pb/core'
import { requireUser } from '@pb/auth'
import { getDb, schema } from '@pb/db'
import { audit } from '@/lib/audit'

type Result = { ok: true } | { ok: false; error: string }

export interface PrintHostInput {
  name: string
  protocol: PrintHostProtocol
  endpoint: string
  /** Undefined leaves the stored key alone; empty string clears it. */
  apiKey?: string
  /** Average draw while printing, for the electricity in a price. Null uses the pricing default. */
  watts?: number | null
  /** Wear and depreciation per printing hour. Null uses the pricing default. */
  hourlyRate?: number | null
}

async function requireAdmin() {
  const user = await requireUser()
  assertCan(
    { id: user.id, role: user.role ?? null, banned: user.banned ?? false },
    'printhost:manage',
  )
  return user
}

function validate(input: PrintHostInput): string | null {
  if (!input.name.trim()) return 'Give the printer a name.'
  if (!isValidEndpoint(input.endpoint)) {
    return 'The address must be a full http or https URL, such as http://octopi.local.'
  }
  // Bounds that no hobby printer comes near, so a slipped digit is caught
  // before it puts a nonsense figure on every quote.
  if (
    input.watts != null &&
    !(Number.isFinite(input.watts) && input.watts >= 0 && input.watts <= 10_000)
  ) {
    return 'The power must be between 0 and 10,000 W.'
  }
  if (
    input.hourlyRate != null &&
    !(Number.isFinite(input.hourlyRate) && input.hourlyRate >= 0 && input.hourlyRate <= 1_000)
  ) {
    return 'The machine rate must be between 0 and 1,000 per hour.'
  }
  return null
}

/** The rate columns, only for the fields the caller sent: undefined leaves them alone. */
function rates(input: PrintHostInput) {
  return {
    ...(input.watts !== undefined && {
      watts: input.watts == null ? null : Math.round(input.watts),
    }),
    // numeric(10,2) comes and goes as a string, to keep the cents exact.
    ...(input.hourlyRate !== undefined && {
      hourlyRate: input.hourlyRate == null ? null : input.hourlyRate.toFixed(2),
    }),
  }
}

export async function createPrintHost(input: PrintHostInput): Promise<Result> {
  try {
    const actor = await requireAdmin()

    const problem = validate(input)
    if (problem) return { ok: false, error: problem }

    const [created] = await getDb()
      .insert(schema.printHosts)
      .values({
        name: input.name.trim(),
        protocol: input.protocol,
        endpoint: input.endpoint.trim().replace(/\/+$/, ''),
        // Encrypted at rest: a database dump should not hand over every printer.
        credentials: input.apiKey ? encryptSecret(input.apiKey) : null,
        ...rates(input),
      })
      .returning({ id: schema.printHosts.id })

    await audit(
      actor,
      'printer.created',
      { type: 'printer', id: created?.id, label: input.name.trim() },
      {
        protocol: input.protocol,
      },
    )
    revalidatePath('/admin/printers')
    return { ok: true }
  } catch (error) {
    if (error instanceof PolicyError) return { ok: false, error: 'Not permitted.' }
    return { ok: false, error: 'Could not add the printer.' }
  }
}

export async function updatePrintHost(id: string, input: PrintHostInput): Promise<Result> {
  try {
    const actor = await requireAdmin()

    const problem = validate(input)
    if (problem) return { ok: false, error: problem }

    const updates: Record<string, unknown> = {
      name: input.name.trim(),
      protocol: input.protocol,
      endpoint: input.endpoint.trim().replace(/\/+$/, ''),
      ...rates(input),
      updatedAt: new Date(),
    }

    /*
     * The form never receives the stored key, so it cannot send it back. An
     * undefined apiKey means "leave it"; an empty string means "remove it".
     * Without that distinction, editing the name would wipe the credential.
     */
    if (input.apiKey !== undefined) {
      updates.credentials = input.apiKey ? encryptSecret(input.apiKey) : null
    }

    const updated = await getDb()
      .update(schema.printHosts)
      .set(updates)
      .where(eq(schema.printHosts.id, id))

    if (updated.rowCount === 0) return { ok: false, error: 'That printer no longer exists.' }

    await audit(
      actor,
      'printer.updated',
      { type: 'printer', id, label: input.name.trim() },
      {
        protocol: input.protocol,
        // Whether the key changed, never the key.
        apiKeyChanged: input.apiKey !== undefined,
        watts: input.watts,
        hourlyRate: input.hourlyRate,
      },
    )

    revalidatePath('/admin/printers')
    return { ok: true }
  } catch (error) {
    if (error instanceof PolicyError) return { ok: false, error: 'Not permitted.' }
    return { ok: false, error: 'Could not save the printer.' }
  }
}

export async function deletePrintHost(id: string): Promise<Result> {
  try {
    const actor = await requireAdmin()
    const [removed] = await getDb()
      .delete(schema.printHosts)
      .where(eq(schema.printHosts.id, id))
      .returning({ name: schema.printHosts.name })

    if (!removed) return { ok: false, error: 'That printer no longer exists.' }

    await audit(actor, 'printer.deleted', { type: 'printer', id, label: removed.name })

    revalidatePath('/admin/printers')
    return { ok: true }
  } catch (error) {
    if (error instanceof PolicyError) return { ok: false, error: 'Not permitted.' }
    return { ok: false, error: 'Could not remove the printer.' }
  }
}

type ProbeResult = { ok: true; version?: string; state?: string } | { ok: false; error: string }

/**
 * Asks the printer whether it is there.
 *
 * Worth its own button: an endpoint typo or a key pasted with trailing
 * whitespace otherwise only shows up when someone tries to send a real print,
 * at which point the failure looks like our fault.
 */
export async function testPrintHost(id: string): Promise<ProbeResult> {
  try {
    await requireAdmin()

    const rows = await getDb()
      .select()
      .from(schema.printHosts)
      .where(eq(schema.printHosts.id, id))
      .limit(1)

    const host = rows[0]
    if (!host) return { ok: false, error: 'That printer no longer exists.' }

    const status = await probeHost({
      id: host.id,
      name: host.name,
      protocol: host.protocol,
      endpoint: host.endpoint,
      apiKey: decryptSecret(host.credentials),
    })

    // Recorded so the list can show which printers were last reachable without
    // probing every one of them on each page load.
    await getDb()
      .update(schema.printHosts)
      .set({ lastSeenOk: status.ok ? new Date() : host.lastSeenOk, updatedAt: new Date() })
      .where(eq(schema.printHosts.id, id))

    revalidatePath('/admin/printers')

    return status.ok
      ? { ok: true, version: status.version, state: status.state }
      : { ok: false, error: status.error ?? 'The printer did not answer.' }
  } catch (error) {
    if (error instanceof PolicyError) return { ok: false, error: 'Not permitted.' }
    return { ok: false, error: 'Could not reach the printer.' }
  }
}
