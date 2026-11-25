'use server'

import { eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import {
  PolicyError,
  assertCan,
  changeSpool,
  clearSpoolmanCache,
  decryptSecret,
  describeSpoolmanSpool,
  listSpoolmanLocations,
  listSpoolmanSpools,
  readKxSpoolMap,
  spoolmanEnabled,
  type PrintHostConfig,
  type StepOutcome,
} from '@pb/core'
import { requireUser } from '@pb/auth'
import { getDb, schema } from '@pb/db'
import { audit } from '@/lib/audit'
import { forgetPrinterLive } from '@/lib/printer-live'

/** Where a spool goes when nobody has said otherwise. */
const DEFAULT_SHELF = 'Storage'

export interface SpoolOption {
  id: number
  label: string
  material: string | null
  colorHex: string | null
  remainingG: number | null
  location: string | null
  /** The slot of this printer it is bound to now, 0-based. */
  inSlot: number | null
  /** Open queue requests that ask for this spool. */
  wantedBy: number
}

export interface SpoolChoices {
  printerName: string
  slotIndex: number
  /** The spool the bridge has on the slot now. */
  current: SpoolOption | null
  spools: SpoolOption[]
  locations: string[]
  /** Where the spool coming out was before it went in, else the shelf. */
  returnLocation: string
}

export type ChangeSpoolResult =
  | { ok: true; steps: StepOutcome[]; message: string }
  | { ok: false; error: string; steps?: StepOutcome[] }

async function actor() {
  const user = await requireUser()
  assertCan(
    { id: user.id, role: user.role ?? null, banned: user.banned ?? false },
    'printhost:send',
  )
  return user
}

async function hostConfig(hostId: string): Promise<PrintHostConfig | null> {
  if (!/^[0-9a-f-]{36}$/i.test(hostId)) return null
  const [host] = await getDb()
    .select()
    .from(schema.printHosts)
    .where(eq(schema.printHosts.id, hostId))
    .limit(1)
  if (!host) return null
  return {
    id: host.id,
    name: host.name,
    protocol: host.protocol,
    endpoint: host.endpoint,
    apiKey: decryptSecret(host.credentials),
  }
}

/** What the change dialog offers for one slot. */
export async function loadSpoolChoices(
  hostId: string,
  slotIndex: number,
): Promise<{ ok: true; choices: SpoolChoices } | { ok: false; error: string }> {
  try {
    await actor()
    if (!spoolmanEnabled()) return { ok: false, error: 'Spoolman is not configured.' }
    const host = await hostConfig(hostId)
    if (!host) return { ok: false, error: 'That printer is gone.' }
    if (host.protocol !== 'kx-bridge') {
      return { ok: false, error: `${host.name} is not a KX-Bridge printer.` }
    }

    clearSpoolmanCache()
    const [listed, locations, bound, wanted] = await Promise.all([
      listSpoolmanSpools(),
      listSpoolmanLocations(),
      readKxSpoolMap(host),
      wantedSpools(),
    ])
    if (!listed.ok) return { ok: false, error: listed.error }
    if (!bound.ok) return { ok: false, error: bound.error }

    const slotOf = new Map([...bound.map].map(([slot, spool]) => [spool, slot]))
    const option = (spool: (typeof listed.spools)[number]): SpoolOption => ({
      id: spool.id,
      label: [spool.vendor, describeSpoolmanSpool(spool)].filter(Boolean).join(' '),
      material: spool.material,
      colorHex: spool.colorHex,
      remainingG: spool.remainingG,
      location: spool.location,
      inSlot: slotOf.get(spool.id) ?? null,
      wantedBy: wanted.get(spool.id) ?? 0,
    })

    const currentId = bound.map.get(slotIndex) ?? null
    const currentSpool = listed.spools.find((spool) => spool.id === currentId)
    const spools = listed.spools
      .filter(
        (spool) =>
          spool.id !== currentId &&
          !spool.archived &&
          (spool.remainingG == null || spool.remainingG > 0),
      )
      .map(option)
      // What the queue is waiting for first, then what is here, then the rest.
      .sort(
        (a, b) =>
          Number(b.wantedBy > 0) - Number(a.wantedBy > 0) ||
          Number(b.location === host.name) - Number(a.location === host.name) ||
          a.label.localeCompare(b.label),
      )

    const returnLocation = currentId != null ? await cameFrom(currentId) : DEFAULT_SHELF
    return {
      ok: true,
      choices: {
        printerName: host.name,
        slotIndex,
        current: currentSpool
          ? option(currentSpool)
          : currentId != null
            ? { ...unknownSpool(currentId), inSlot: slotIndex }
            : null,
        spools,
        locations: [...new Set([...locations, DEFAULT_SHELF, returnLocation])]
          .filter((location) => location !== host.name)
          .sort(),
        returnLocation,
      },
    }
  } catch (error) {
    if (error instanceof PolicyError) return { ok: false, error: 'Not permitted.' }
    return { ok: false, error: 'Could not load the spools.' }
  }
}

/** Puts a spool into a slot — or none — on the printer, the bridge and Spoolman. */
export async function changeSlotSpool(
  hostId: string,
  slotIndex: number,
  spoolId: number | null,
  returnLocation: string,
): Promise<ChangeSpoolResult> {
  try {
    const user = await actor()
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 15) {
      return { ok: false, error: 'No such slot.' }
    }
    const shelf = returnLocation.trim() || DEFAULT_SHELF
    const host = await hostConfig(hostId)
    if (!host) return { ok: false, error: 'That printer is gone.' }

    clearSpoolmanCache()
    const listed = await listSpoolmanSpools()
    if (!listed.ok) return { ok: false, error: listed.error }
    const spool = spoolId == null ? null : listed.spools.find((s) => s.id === spoolId)
    if (spool === undefined) return { ok: false, error: `Spoolman has no spool #${spoolId}.` }

    const result = await changeSpool(
      host,
      { slotIndex, spool, returnLocation: shelf },
      { spools: listed.spools },
    )
    forgetPrinterLive(host.id)
    if ('refused' in result) return { ok: false, error: result.refused }

    await audit(
      user,
      'printer.spool_changed',
      { type: 'printer', id: host.id, label: host.name },
      {
        slot: slotIndex + 1,
        spoolId: spool?.id ?? null,
        // Where the new spool was, so taking it out later puts it back there.
        spoolFrom: spool?.location && spool.location !== host.name ? spool.location : null,
        previousSpoolId: result.previousSpoolId,
        returnedTo: result.previousSpoolId != null ? shelf : null,
        movedFromSlot: result.movedFromSlot != null ? result.movedFromSlot + 1 : null,
        steps: result.steps.map(({ key, status, detail }) => ({ key, status, detail })),
      },
    )
    revalidatePath('/printers')
    revalidatePath('/queue')

    const what = spool ? `spool #${spool.id}` : 'no spool'
    return result.ok
      ? { ok: true, steps: result.steps, message: `Slot ${slotIndex + 1} now has ${what}.` }
      : {
          ok: false,
          steps: result.steps,
          error: 'Some steps did not go through. Retrying is safe.',
        }
  } catch (error) {
    if (error instanceof PolicyError) return { ok: false, error: 'Not permitted.' }
    return { ok: false, error: 'Could not change the spool.' }
  }
}

/** Spoolman spool id → how many open requests ask for it. */
async function wantedSpools(): Promise<Map<number, number>> {
  const rows = await getDb().execute<{ spool: number; requests: number }>(sql`
    SELECT f.spoolman_spool_id AS spool, count(DISTINCT r.id)::int AS requests
    FROM print_request_filaments f JOIN print_requests r ON r.id = f.request_id
    WHERE f.spoolman_spool_id IS NOT NULL AND r.status = 'requested'
    GROUP BY f.spoolman_spool_id`)
  return new Map(rows.rows.map((row) => [Number(row.spool), Number(row.requests)]))
}

/** Where a spool was before the last change that put it into a printer. */
async function cameFrom(spoolId: number): Promise<string> {
  const rows = await getDb().execute<{ location: string | null }>(sql`
    SELECT detail->>'spoolFrom' AS location FROM audit_events
    WHERE action = 'printer.spool_changed' AND (detail->>'spoolId')::int = ${spoolId}
    ORDER BY occurred_at DESC LIMIT 1`)
  return rows.rows[0]?.location || DEFAULT_SHELF
}

function unknownSpool(id: number): Omit<SpoolOption, 'inSlot'> {
  return {
    id,
    label: `Spool #${id}`,
    material: null,
    colorHex: null,
    remainingG: null,
    location: null,
    wantedBy: 0,
  }
}
