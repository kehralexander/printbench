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
import { FilamentLibrary } from './library'
import { SpoolmanInventory } from './spoolman-inventory'
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Filaments' }
export default async function FilamentsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>
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
        />
      </>
    )
  }

  const [spools, filaments] = await Promise.all([listSpools(getDb()), listFilaments(getDb())])
  return (
    <>
      <PageHeader
        title="Filaments"
        description="Your spools, what’s left, and what you’ve printed with them."
      />
      <FilamentLibrary
        spools={spools}
        filaments={filaments}
        canManage={can(user, 'filament:manage')}
      />
    </>
  )
}
