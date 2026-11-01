import Link from 'next/link'
import type { Route } from 'next'
import { notFound } from 'next/navigation'
import { Users } from 'lucide-react'
import { can, creatorBySlug, searchModels } from '@pb/core'
import { getSessionUser } from '@pb/auth'
import { getDb } from '@pb/db'
import { PageHeader } from '@/components/shell/page-header'
import { Breadcrumbs } from '@/components/shell/breadcrumbs'
import { NotPermitted } from '@/components/shell/not-permitted'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { UrlSortControl } from '@/components/ui/sort-control'
import { CreatorItemSection } from '@/components/creator/creator-item-section'
import { DEFAULT_ITEM_SORT, ITEM_SORT_OPTIONS } from '@/components/model/item-sort'
import { pickSort } from '@/lib/sort'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const creator = await creatorBySlug(getDb(), slug)
  return { title: creator?.name ?? 'Creator' }
}

export default async function CreatorPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await getSessionUser()
  if (!can({ id: user?.id ?? '', role: user?.role ?? null }, 'model:view')) {
    return <NotPermitted what="creators" />
  }

  const { slug } = await params
  const sort = pickSort((await searchParams).sort, ITEM_SORT_OPTIONS, DEFAULT_ITEM_SORT)
  const db = getDb()

  const creator = await creatorBySlug(db, slug)
  if (!creator) notFound()

  // Reuse search for both item types so filtering, sorting and the hit shape
  // stay consistent with the rest of the application. Keep the initial
  // batches deliberately small: some creators may have thousands of items.
  const [packages, models] = await Promise.all([
    searchModels(db, {
      creatorIds: [creator.id],
      isPackage: true,
      includeFacets: false,
      sort,
      limit: 24,
    }),
    searchModels(db, {
      creatorIds: [creator.id],
      isPackage: false,
      includeFacets: false,
      sort,
      limit: 48,
    }),
  ])

  return (
    <>
      <Breadcrumbs items={[{ label: 'Creators', href: '/creators' }]} />

      <PageHeader
        title={creator.name}
        description={creator.notes ?? undefined}
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href={`/models?creator=${creator.id}` as Route}>Search within</Link>
          </Button>
        }
        // No count line here: each section below heads itself with its count.
      />

      {packages.total === 0 && models.total === 0 ? (
        <EmptyState
          icon={<Users />}
          title="Nothing here yet"
          description="No models or packages are attributed to this creator, or the ones that were are missing from disk."
        />
      ) : (
        <>
          <ListToolbar
            sort={
              <UrlSortControl
                options={ITEM_SORT_OPTIONS}
                value={sort}
                defaultValue={DEFAULT_ITEM_SORT}
                count={packages.total + models.total}
              />
            }
          />

          {/* Keyed by sort: the sections hold their loaded pages in state, which a new order invalidates. */}
          {packages.total > 0 && (
            <CreatorItemSection
              key={`package-${sort}`}
              creatorId={creator.id}
              type="package"
              title="Packages"
              sort={sort}
              initialItems={packages.hits}
              total={packages.total}
              batchSize={24}
              className="mb-8"
            />
          )}

          {models.total > 0 && (
            <CreatorItemSection
              key={`model-${sort}`}
              creatorId={creator.id}
              type="model"
              title="Models"
              sort={sort}
              initialItems={models.hits}
              total={models.total}
              batchSize={48}
            />
          )}
        </>
      )}
    </>
  )
}
