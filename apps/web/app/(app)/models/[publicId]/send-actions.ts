'use server'

import { eq } from 'drizzle-orm'
import {
  PolicyError,
  assertCan,
  canSendToPrinter,
  createStorageAdapter,
  decryptSecret,
  describeSlot,
  gcodePaints,
  libraryLocationFromRow,
  planSlots,
  readKxSlots,
  sendToPrinter,
  startOnKxBridge,
  type FilamentSlot,
  type PrintHostConfig,
  type SendResult as HostSendResult,
  type SlotAssignment,
  type StorageAdapter,
  type WantedFilament,
} from '@pb/core'
import { requireUser } from '@pb/auth'
import { getDb, schema } from '@pb/db'
import { audit } from '@/lib/audit'

/**
 * Asked for instead of starting, when the slots to print from are not clear:
 * what the file was sliced with, what is loaded, and the best guess.
 */
export interface SlotChoice {
  printerName: string
  paints: { paint: number; colorHex: string; material: string; slot: number | null }[]
  slots: FilamentSlot[]
}

export type SendResult =
  { ok: true; message: string } | { ok: false; error: string; choose?: SlotChoice }

/**
 * A sliced file is tens of megabytes at worst. Anything larger is not gcode,
 * and buffering it to push at a Raspberry Pi would be a mistake in both places.
 */
const MAX_SEND_BYTES = 256 * 1024 * 1024

/** Printers reachable from this instance, for the send menu. */
export async function listPrintHosts(): Promise<{ id: string; name: string }[]> {
  try {
    const user = await requireUser()
    assertCan(
      { id: user.id, role: user.role ?? null, banned: user.banned ?? false },
      'printhost:send',
    )
  } catch {
    return []
  }

  const rows = await getDb()
    .select({ id: schema.printHosts.id, name: schema.printHosts.name })
    .from(schema.printHosts)
    .orderBy(schema.printHosts.name)

  return rows
}

/**
 * Uploads one sliced file to a configured printer, optionally starting it.
 *
 * Done here rather than on the job queue, deliberately. The transfer is small
 * and quick, and the answers that matter — wrong API key, printer already
 * printing, host switched off — are only useful if the person who pressed the
 * button sees them. Queued, they would land in a log nobody reads.
 */
export async function sendFileToPrinter(
  fileId: string,
  hostId: string,
  startPrint: boolean,
  options: {
    /** Slots picked by hand, after a SlotChoice. */
    slots?: SlotAssignment[]
    /** What the queue request asks for, to pick the slot by. */
    wanted?: WantedFilament | null
  } = {},
): Promise<SendResult> {
  try {
    const user = await requireUser()
    assertCan(
      { id: user.id, role: user.role ?? null, banned: user.banned ?? false },
      'printhost:send',
    )

    const db = getDb()

    const hostRows = await db
      .select()
      .from(schema.printHosts)
      .where(eq(schema.printHosts.id, hostId))
      .limit(1)

    const host = hostRows[0]
    if (!host) return { ok: false, error: 'That printer is no longer configured.' }

    const rows = await db
      .select({ file: schema.modelFiles, model: schema.models, library: schema.libraries })
      .from(schema.modelFiles)
      .innerJoin(schema.models, eq(schema.models.id, schema.modelFiles.modelId))
      .innerJoin(schema.libraries, eq(schema.libraries.id, schema.models.libraryId))
      .where(eq(schema.modelFiles.id, fileId))
      .limit(1)

    const row = rows[0]
    if (!row || row.file.missingAt) return { ok: false, error: 'That file is no longer on disk.' }
    if (!canSendToPrinter(row.file.extension)) {
      return {
        ok: false,
        error: 'Only sliced files can be sent. Open the mesh in a slicer first.',
      }
    }

    const storage = createStorageAdapter(libraryLocationFromRow(row.library))

    // A model that is a single loose file has no folder of its own.
    const relativePath = row.model.isFileModel
      ? row.model.path
      : `${row.model.path}/${row.file.filename}`

    const info = await storage.stat(relativePath).catch(() => null)
    if (!info) return { ok: false, error: 'That file is no longer on disk.' }
    if (info.size > MAX_SEND_BYTES) {
      return { ok: false, error: 'That file is too large to send to a printer.' }
    }

    const data = await readAll(storage, relativePath)
    const filename = row.file.filename.split('/').pop() ?? 'print.gcode'

    const config: PrintHostConfig = {
      id: host.id,
      name: host.name,
      protocol: host.protocol,
      endpoint: host.endpoint,
      apiKey: decryptSecret(host.credentials),
    }

    let result: HostSendResult
    let startedOn: string | null = null
    if (config.protocol === 'kx-bridge' && startPrint) {
      const started = await startOnSlots(config, { filename, data }, options)
      if ('choose' in started) {
        return { ok: false, error: started.error, choose: started.choose }
      }
      result = started.result
      startedOn = started.startedOn
    } else {
      result = await sendToPrinter(config, { filename, data }, { startPrint })
    }

    await audit(
      user,
      'model.sent_to_printer',
      { type: 'model', id: row.model.publicId, label: row.model.name },
      {
        printer: host.name,
        file: filename,
        startPrint,
        slots: startedOn ?? undefined,
        error: result.ok ? undefined : result.error,
      },
    )
    if (!result.ok) return { ok: false, error: result.error ?? 'The printer refused the file.' }

    return {
      ok: true,
      message: startPrint
        ? `Sent to ${host.name} and started${startedOn ? ` on ${startedOn}` : ''}.`
        : `Sent to ${host.name}. Start it from the printer.`,
    }
  } catch (error) {
    if (error instanceof PolicyError) return { ok: false, error: 'Not permitted.' }
    return { ok: false, error: 'Could not send the file.' }
  }
}

/**
 * KX-Bridge: start on named slots rather than let the bridge guess and then
 * ask in its own page. Slots picked by hand are used as given; otherwise they
 * are worked out, and asked for when that is not certain.
 */
async function startOnSlots(
  host: PrintHostConfig,
  file: { filename: string; data: Uint8Array<ArrayBuffer> },
  options: { slots?: SlotAssignment[]; wanted?: WantedFilament | null },
): Promise<
  { result: HostSendResult; startedOn: string | null } | { error: string; choose: SlotChoice }
> {
  const slots = await readKxSlots(host).catch(() => null)
  if (!slots) {
    return {
      result: { ok: false, error: `Could not read which filament ${host.name} has loaded.` },
      startedOn: null,
    }
  }
  const loaded = slots.filter((slot) => slot.loaded)
  // No ACE to choose from: the bridge's own start is all there is.
  if (loaded.length === 0) {
    return { result: await sendToPrinter(host, file, { startPrint: true }), startedOn: null }
  }

  const paints = gcodePaints(file.data)
  let assignments: SlotAssignment[]
  if (options.slots && options.slots.length > 0) {
    const usable = new Set(loaded.map((slot) => slot.index))
    if (options.slots.some((choice) => !usable.has(choice.slot))) {
      return {
        result: { ok: false, error: 'A chosen slot is empty now. Open the send again.' },
        startedOn: null,
      }
    }
    assignments = options.slots
  } else {
    const plan = planSlots(paints, slots, options.wanted ?? null)
    if (!plan.sure) {
      return {
        error: 'Choose which slot to print from.',
        choose: {
          printerName: host.name,
          paints: plan.paints.map(({ paint, colorHex, material, slot }) => ({
            paint,
            colorHex,
            material,
            slot,
          })),
          slots: loaded,
        },
      }
    }
    assignments = plan.paints.map(({ paint, slot }) => ({ paint, slot: slot! }))
  }

  const result = await startOnKxBridge(host, file, paints, assignments, slots)
  const bySlot = new Map(slots.map((slot) => [slot.index, slot]))
  return {
    result,
    startedOn: assignments.map(({ slot }) => describeSlot(bySlot.get(slot), slot)).join(', '),
  }
}

async function readAll(
  storage: StorageAdapter,
  relativePath: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Buffer[] = []
  for await (const chunk of await storage.createReadStream(relativePath)) {
    chunks.push(chunk as Buffer)
  }

  /*
   * Copied into a plain ArrayBuffer rather than handed over as-is. A Buffer is
   * a view onto Node's shared allocation pool, so its bytes are not necessarily
   * the whole buffer — and its type admits SharedArrayBuffer, which fetch will
   * not take as a body.
   */
  const joined = Buffer.concat(chunks)
  const copy = new Uint8Array(new ArrayBuffer(joined.byteLength))
  copy.set(joined)
  return copy
}
