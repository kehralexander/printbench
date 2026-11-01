import Link from 'next/link'
import { asc, desc, sql } from 'drizzle-orm'
import { Activity } from 'lucide-react'
import { getSessionUser } from '@pb/auth'
import { can } from '@pb/core'
import { getDb, schema } from '@pb/db'
import { PageHeader } from '@/components/shell/page-header'
import { NotPermitted } from '@/components/shell/not-permitted'
import { Button } from '@/components/ui/button'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { UrlSortControl } from '@/components/ui/sort-control'
import { pickSort, type SortOption } from '@/lib/sort'
import { AddPrinterButton, PrinterList } from './printer-list'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Printers' }

type PrinterSort = 'name' | 'type' | 'added'
const SORTS: readonly SortOption<PrinterSort>[] = [
  { value: 'name', label: 'Name' },
  { value: 'type', label: 'Type' },
  { value: 'added', label: 'Recently added' },
]

export default async function PrintersPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>
}) {
  const user = await getSessionUser()
  if (!can({ id: user?.id ?? '', role: user?.role ?? null }, 'printhost:manage')) {
    return <NotPermitted what="printer management" />
  }

  const sort = pickSort((await searchParams).sort, SORTS, 'name')
  // By name by default, the same order as the Printer status page.
  const byName = sql`lower(${schema.printHosts.name})`
  const order = {
    name: [byName],
    type: [asc(schema.printHosts.protocol), byName],
    added: [desc(schema.printHosts.createdAt)],
  }[sort]

  const hosts = await getDb()
    .select({
      id: schema.printHosts.id,
      name: schema.printHosts.name,
      protocol: schema.printHosts.protocol,
      endpoint: schema.printHosts.endpoint,
      credentials: schema.printHosts.credentials,
      lastSeenOk: schema.printHosts.lastSeenOk,
    })
    .from(schema.printHosts)
    .orderBy(...order)

  return (
    <>
      <PageHeader
        title="Printers"
        description="Networked printers you can send a sliced file to. Bambu printers are driven through Bambu Studio instead. Use Open in… on the model page."
        actions={
          <>
            <Button asChild variant="secondary">
              <Link href="/printers">
                <Activity />
                Printer status
              </Link>
            </Button>
            {/* The empty state offers the same button. */}
            {hosts.length > 0 && <AddPrinterButton />}
          </>
        }
      />

      {hosts.length > 1 && (
        <ListToolbar sort={<UrlSortControl options={SORTS} value={sort} defaultValue="name" />} />
      )}

      <PrinterList
        hosts={hosts.map((host) => ({
          id: host.id,
          name: host.name,
          protocol: host.protocol,
          endpoint: host.endpoint,
          // Only whether a key exists ever reaches the browser, never the key.
          hasApiKey: host.credentials != null,
          lastSeenOk: host.lastSeenOk?.toISOString() ?? null,
        }))}
      />
    </>
  )
}
