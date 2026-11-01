import { eq } from 'drizzle-orm'
import { decryptSecret, readPrinterStatus, type PrinterStatus } from '@pb/core'
import { getDb, schema } from '@pb/db'

/**
 * Live printer readings for the printer status page, shared between everyone
 * looking at it.
 *
 * That page refreshes itself every few seconds, and each refresh used to ask
 * every printer directly — three open tabs meant three times the requests to
 * a small board that is also busy printing. Within MAX_AGE_MS a reading is
 * handed out again instead, and a read already under way is joined rather
 * than repeated. Short enough that the page still reads as live; the browser
 * ticks the numbers on in between (components/printer/live-progress.tsx).
 */
const MAX_AGE_MS = 5_000

type Host = typeof schema.printHosts.$inferSelect

export interface LiveReading {
  status: PrinterStatus
  /** Epoch ms the printer answered. */
  readAt: number
}

/** Every printer at once, each with how old its reading is right now. */
export async function readPrintersLive(
  hosts: Host[],
): Promise<(LiveReading & { ageSec: number })[]> {
  const readings = await Promise.all(hosts.map(readPrinterLive))
  const now = Date.now()
  return readings.map((reading) => ({
    ...reading,
    ageSec: Math.max(0, now - reading.readAt) / 1000,
  }))
}

interface Entry {
  /** Changes when the printer is edited, so a new address is read at once. */
  key: string
  reading: Promise<LiveReading>
  /** Epoch ms the read finished; null while it is still running. */
  readAt: number | null
}

const cache = new Map<string, Entry>()

export function readPrinterLive(host: Host): Promise<LiveReading> {
  const key = [host.protocol, host.endpoint, host.credentials ?? ''].join('\n')
  const now = Date.now()
  const cached = cache.get(host.id)
  if (cached && cached.key === key && (cached.readAt == null || now - cached.readAt < MAX_AGE_MS))
    return cached.reading

  // Hosts that were deleted would otherwise stay here for the life of the process.
  for (const [id, entry] of cache) {
    if (entry.readAt != null && now - entry.readAt > MAX_AGE_MS * 12) cache.delete(id)
  }

  const entry: Entry = { key, readAt: null, reading: null! }
  entry.reading = read(host).then(
    (reading) => {
      entry.readAt = reading.readAt
      return reading
    },
    (error: unknown) => {
      if (cache.get(host.id) === entry) cache.delete(host.id)
      throw error
    },
  )
  cache.set(host.id, entry)
  return entry.reading
}

/** One real read; also the only place that records the printer as reachable. */
async function read(host: Host): Promise<LiveReading> {
  const status = await readPrinterStatus({
    id: host.id,
    name: host.name,
    protocol: host.protocol,
    endpoint: host.endpoint,
    apiKey: decryptSecret(host.credentials),
  })
  const readAt = Date.now()
  if (status.state !== 'offline') {
    await getDb()
      .update(schema.printHosts)
      .set({ lastSeenOk: new Date(readAt) })
      .where(eq(schema.printHosts.id, host.id))
      .catch(() => undefined)
  }
  return { status, readAt }
}
