import Link from 'next/link'
import type { Route } from 'next'
import { notFound } from 'next/navigation'
import { Tag } from 'lucide-react'
import { can, searchModels, tagBySlug } from '@pb/core'
import { getSessionUser } from '@pb/auth'
import { getDb } from '@pb/db'
import { PageHeader } from '@/components/shell/page-header'
import { Breadcrumbs } from '@/components/shell/breadcrumbs'
import { NotPermitted } from '@/components/shell/not-permitted'
import { EmptyState } from '@/components/ui/empty-state'
import { Swatch } from '@/components/ui/swatch'
import { Button } from '@/components/ui/button'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { UrlSortControl } from '@/components/ui/sort-control'
import { ModelGrid } from '@/components/model/model-grid'
import { DEFAULT_ITEM_SORT, ITEM_SORT_OPTIONS } from '@/components/model/item-sort'
import { pickSort } from '@/lib/sort'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const tag = await tagBySlug(getDb(), slug)
  return { title: tag ? `#${tag.name}` : 'Tag' }
}

export default async function TagPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await getSessionUser()
  if (!can({ id: user?.id ?? '', role: user?.role ?? null }, 'model:view')) {
    return <NotPermitted what="tags" />
  }

  const { slug } = await params
  const sort = pickSort((await searchParams).sort, ITEM_SORT_OPTIONS, DEFAULT_ITEM_SORT)
  const db = getDb()

  const tag = await tagBySlug(db, slug)
  if (!tag) notFound()

  const result = await searchModels(db, { tagIds: [tag.id], sort, limit: 96 })

  return (
    <>
      <Breadcrumbs items={[{ label: 'Tags', href: '/tags' }]} />

      <PageHeader
        title={tag.name}
        description={
          <span className="inline-flex items-center gap-1.5">
            {tag.color && <Swatch color={tag.color} />}
            {tag.modelCount} model{tag.modelCount === 1 ? '' : 's'}
          </span>
        }
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href={`/models?tag=${tag.id}` as Route}>Search within</Link>
          </Button>
        }
      />

      {result.hits.length === 0 ? (
        <EmptyState
          icon={<Tag />}
          title="Nothing tagged with this"
          description="Every model that had this tag is missing from disk, or the tag is no longer used."
        />
      ) : (
        <>
          <ListToolbar
            sort={
              <UrlSortControl
                options={ITEM_SORT_OPTIONS}
                value={sort}
                defaultValue={DEFAULT_ITEM_SORT}
                count={result.total}
              />
            }
          />
          <ModelGrid models={result.hits} />
          {/* The rest is one click away through the header's "Search within". */}
          {result.total > result.hits.length && (
            <p className="mt-4 text-sm text-[var(--color-ink-muted)]">
              Showing {result.hits.length} of {result.total}.
            </p>
          )}
        </>
      )}
    </>
  )
}
