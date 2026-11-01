import { decryptSecret, readPrinterStatus, trackPrinter } from '@pb/core'
import { getDb, schema } from '@pb/db'

/**
 * Watches every configured printer, so the queue and the print history follow
 * what actually happens on them. See printer-tracking.ts for what a status
 * turns into.
 *
 * A plain interval rather than a pg-boss schedule: cron stops at one minute,
 * and a print cancelled and restarted inside a minute would be missed. Ticks
 * never overlap — a slow printer delays the next one instead of doubling up.
 *
 * PRINTER_POLL_SECONDS sets the interval (default 20); 0 turns watching off.
 */
const DEFAULT_INTERVAL_S = 20

export function startPrinterWatch(): () => Promise<void> {
  const seconds = Number(process.env.PRINTER_POLL_SECONDS ?? DEFAULT_INTERVAL_S)
  if (!Number.isFinite(seconds) || seconds <= 0) {
    console.log('[printers] watching is off (PRINTER_POLL_SECONDS=0)')
    return async () => {}
  }

  let stopped = false
  let running: Promise<void> | null = null
  let timer: ReturnType<typeof setTimeout> | undefined

  const loop = async () => {
    if (stopped) return
    running = tick().catch((error: unknown) => {
      console.error('[printers] watch tick failed:', error)
    })
    await running
    running = null
    if (!stopped) timer = setTimeout(() => void loop(), Math.max(5, seconds) * 1000)
  }
  void loop()
  console.log(`[printers] watching printers every ${seconds}s`)

  return async () => {
    stopped = true
    clearTimeout(timer)
    await running
  }
}

/** One pass over every printer. Each is independent; one failing skips only itself. */
export async function tick(): Promise<void> {
  const db = getDb()
  const hosts = await db.select().from(schema.printHosts)
  await Promise.all(
    hosts.map(async (host) => {
      try {
        const status = await readPrinterStatus({
          id: host.id,
          name: host.name,
          protocol: host.protocol,
          endpoint: host.endpoint,
          apiKey: decryptSecret(host.credentials),
        })
        await trackPrinter(db, { id: host.id, name: host.name }, status)
      } catch (error) {
        console.error(`[printers] could not track "${host.name}":`, error)
      }
    }),
  )
}
