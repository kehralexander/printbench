import { notFound, redirect } from 'next/navigation'
import { getSessionUser } from '@pb/auth'
import {
  can,
  listFilaments,
  listSpools,
  spoolHistory,
  spoolPrints,
  spoolmanEnabled,
} from '@pb/core'
import { getDb } from '@pb/db'
import { NotPermitted } from '@/components/shell/not-permitted'
import { spoolSubtitle } from '../spool-label'
import { Breadcrumbs } from '@/components/shell/breadcrumbs'
import { SpoolDetails } from '../spool-details'
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Spool' }
export default async function SpoolPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!can(user, 'filament:view')) return <NotPermitted what="the filament library" />
  // The built-in inventory is switched off while Spoolman owns it.
  if (spoolmanEnabled()) redirect('/filaments')
  const { id } = await params
  const spools = await listSpools(getDb())
  const spool = spools.find((s) => s.id === id)
  if (!spool) notFound()
  const [history, filaments, prints] = await Promise.all([
    spoolHistory(getDb(), id),
    listFilaments(getDb()),
    spoolPrints(getDb(), id),
  ])
  return (
    <>
      <Breadcrumbs items={[{ label: 'Filaments', href: '/filaments' }]} />
      <SpoolDetails
        title={spool.label || spool.filament.name}
        description={spoolSubtitle(spool)}
        spool={spool}
        filaments={filaments}
        history={history}
        prints={prints}
        canManage={can(user, 'filament:manage')}
      />
    </>
  )
}
