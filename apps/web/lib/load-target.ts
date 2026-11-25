import { eq } from 'drizzle-orm'
import { can, printerSnapshots, spoolmanEnabled } from '@pb/core'
import { schema, type Database } from '@pb/db'
import type { LoadTarget } from '@/components/printer/change-spool'

/**
 * The printer a spool can be loaded into from outside the printer page — the
 * queue's "not loaded", the spool inventory: the first idle KX-Bridge printer
 * with slots, from the worker's last reading. Null when the user may not
 * change spools, Spoolman is not set up, or no such printer is free.
 */
export async function spoolLoadTarget(
  db: Database,
  user: Parameters<typeof can>[0],
): Promise<LoadTarget | null> {
  if (!can(user, 'printhost:send') || !spoolmanEnabled()) return null
  const [hosts, printers] = await Promise.all([
    db
      .select({ id: schema.printHosts.id })
      .from(schema.printHosts)
      .where(eq(schema.printHosts.protocol, 'kx-bridge')),
    printerSnapshots(db),
  ])
  for (const { id } of hosts) {
    const printer = printers.find((candidate) => candidate.id === id)
    if (!printer?.fresh || !printer.status || printer.status.busy) continue
    const slots = printer.status.slots ?? []
    if (slots.length > 0) return { hostId: printer.id, printerName: printer.name, slots }
  }
  return null
}
