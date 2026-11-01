import { getSessionUser } from '@pb/auth'
import {
  can,
  clearSpoolmanCache,
  listFilaments,
  listSpoolmanSpools,
  listSpools,
  spoolmanUrl,
} from '@pb/core'
import { getDb } from '@pb/db'
import { NotPermitted } from '@/components/shell/not-permitted'
import { PageHeader } from '@/components/shell/page-header'
import { pickSort } from '@/lib/sort'
import { FilamentLibrary } from './library'
import { SPOOLMAN_SORTS } from './sort'
import { SpoolmanInventory } from './spoolman-inventory'
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Filaments' }
export default async function FilamentsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string; sort?: string }>
}) {
  const user = await getSessionUser()
  if (!can(user, 'filament:view')) return <NotPermitted what="the filament library" />

  // With Spoolman configured it owns the inventory, and this page only shows it.
  const spoolman = spoolmanUrl()
  if (spoolman) {
    // This page is where people look after weighing a spool, so it is always current.
    clearSpoolmanCache()
    const [result, params] = await Promise.all([listSpoolmanSpools(), searchParams])
    return (
      <>
        <PageHeader
          title="Filaments"
          description="Your spools in Spoolman and what’s left on them."
        />
        <SpoolmanInventory
          result={result}
          baseUrl={spoolman}
          showArchived={params.archived === '1'}
          sort={pickSort(params.sort, SPOOLMAN_SORTS, 'name')}
        />
      </>
    )
  }

  const [spools, filaments] = await Promise.all([listSpools(getDb()), listFilaments(getDb())])
  // The library renders its own header: its "Add spool" action opens a form in the list.
  return (
    <FilamentLibrary
      spools={spools}
      filaments={filaments}
      canManage={can(user, 'filament:manage')}
    />
  )
}
