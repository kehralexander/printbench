import Link from 'next/link'
import type { Route } from 'next'
import { notFound } from 'next/navigation'
import { FolderTree } from 'lucide-react'
import { sql } from 'drizzle-orm'
import {
  can,
  collectionBySlug,
  listCollections,
  modelFormatSql,
  modelGeometrySql,
  modelThumbnailSql,
} from '@pb/core'
import { getSessionUser } from '@pb/auth'
import { getDb } from '@pb/db'
import { PageHeader } from '@/components/shell/page-header'
import { Breadcrumbs } from '@/components/shell/breadcrumbs'
import { NotPermitted } from '@/components/shell/not-permitted'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { SectionHeader } from '@/components/ui/section-header'
import { UrlSortControl } from '@/components/ui/sort-control'
import { ModelGrid } from '@/components/model/model-grid'
import { pickSort, type SortOption } from '@/lib/sort'

export const dynamic = 'force-dynamic'

type Row = {
  public_id: string
  name: string
  path: string
  file_count: number
  total_size: string
  library_name: string
  is_package: boolean
  preview_extension: string | null
  preview_image_file_id: string | null
  thumb_file_id: string | null
  thumb_key: string | null
  bbox_x: string | null
  bbox_y: string | null
  bbox_z: string | null
}

type CollectionSort = 'position' | 'name' | 'recent'

const SORT_OPTIONS: SortOption<CollectionSort>[] = [
  { value: 'position', label: 'Collection order' },
  { value: 'name', label: 'Name' },
  { value: 'recent', label: 'Newest' },
]

const ORDER = {
  position: sql`cm.position, m.name`,
  name: sql`m.name, cm.position`,
  recent: sql`m.created_at DESC, m.name`,
} satisfies Record<CollectionSort, unknown>

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const collection = await collectionBySlug(getDb(), slug)
  return { title: collection?.name ?? 'Collection' }
}

export default async function CollectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await getSessionUser()
  if (!can({ id: user?.id ?? '', role: user?.role ?? null }, 'model:view')) {
    return <NotPermitted what="collections" />
  }

  const { slug } = await params
  const sort = pickSort((await searchParams).sort, SORT_OPTIONS, 'position')
  const db = getDb()

  const collection = await collectionBySlug(db, slug)
  if (!collection) notFound()

  /*
   * Not searchModels: search has no collection filter, and adding one for a
   * page that never needs ranking or facets would be more surface than it is
   * worth. The position column is the collection's own ordering.
   */
  const models = await db.execute<Row>(sql`
    SELECT m.public_id, m.name, m.path, m.file_count, m.total_size, m.is_package,
           l.name AS library_name,
           ${modelFormatSql(sql`m.id`, sql`m.preview_file_id`)} AS preview_extension,
           CASE WHEN selected.category = 'image' THEN selected.id END AS preview_image_file_id,
           thumb.id AS thumb_file_id, thumb.thumb_key,
           geometry.bbox_x, geometry.bbox_y, geometry.bbox_z
    FROM collection_models cm
    JOIN models m ON m.id = cm.model_id
    JOIN libraries l ON l.id = m.library_id
    LEFT JOIN model_files selected ON selected.id = m.preview_file_id
    LEFT JOIN LATERAL (${modelGeometrySql(sql`m.id`, sql`m.preview_file_id`)}) geometry ON true
    LEFT JOIN LATERAL (${modelThumbnailSql(sql`m.id`, sql`m.preview_file_id`)}) thumb ON true
    WHERE cm.collection_id = ${collection.id} AND m.missing_at IS NULL
    ORDER BY ${ORDER[sort]}`)

  const all = await listCollections(db)
  const children = all.filter((c) => c.parentId === collection.id)
  // The whole trail up to the root, nearest last; the seen set guards against a cycle.
  const ancestors: typeof all = []
  const seen = new Set([collection.id])
  for (
    let parent = all.find((c) => c.id === collection.parentId);
    parent && !seen.has(parent.id);
    parent = all.find((c) => c.id === parent?.parentId)
  ) {
    seen.add(parent.id)
    ancestors.unshift(parent)
  }

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Collections', href: '/collections' },
          ...ancestors.map((c) => ({ label: c.name, href: `/collections/${c.slug}` })),
        ]}
      />

      <PageHeader title={collection.name} description={collection.caption ?? undefined}>
        {models.rows.length.toLocaleString()} model{models.rows.length === 1 ? '' : 's'}
      </PageHeader>

      {children.length > 0 && (
        <div className="mb-6">
          <SectionHeader title="Inside this collection" className="mb-2" />
          <div className="flex flex-wrap gap-2">
            {children.map((child) => (
              <Button key={child.id} asChild variant="secondary" size="sm">
                <Link href={`/collections/${child.slug}` as Route}>
                  {child.name}
                  <span className="text-xs text-[var(--color-ink-faint)]">{child.modelCount}</span>
                </Link>
              </Button>
            ))}
          </div>
        </div>
      )}

      {models.rows.length === 0 ? (
        <EmptyState
          icon={<FolderTree />}
          title="Nothing in here yet"
          description="Open a model and add it to this collection from its page."
        />
      ) : (
        <>
          <ListToolbar
            sort={
              <UrlSortControl
                options={SORT_OPTIONS}
                value={sort}
                defaultValue="position"
                count={models.rows.length}
              />
            }
          />
          <ModelGrid
            models={models.rows.map((model) => ({
              publicId: model.public_id,
              name: model.name,
              path: model.path,
              fileCount: model.file_count,
              totalSize: Number(model.total_size),
              libraryName: model.library_name,
              isPackage: model.is_package,
              previewExtension: model.preview_extension,
              previewImageFileId: model.preview_image_file_id,
              thumbFileId: model.thumb_file_id,
              thumbKey: model.thumb_key,
              bboxX: Number(model.bbox_x ?? 0),
              bboxY: Number(model.bbox_y ?? 0),
              bboxZ: Number(model.bbox_z ?? 0),
            }))}
          />
        </>
      )}
    </>
  )
}
