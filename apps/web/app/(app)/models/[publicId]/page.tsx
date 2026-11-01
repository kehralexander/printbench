import type { ReactNode } from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { sql } from 'drizzle-orm'
import {
  AlertTriangle,
  Box,
  Boxes,
  FileStack,
  FolderOpen,
  HardDrive,
  Layers,
  Package,
} from 'lucide-react'
import { getDb } from '@pb/db'
import { filamentOptions } from '@/lib/filament-options'
import { getSessionUser } from '@pb/auth'
import {
  can,
  canSendToPrinter,
  collectionsForModel,
  getSettings,
  isLiked,
  listCollections,
  listPrints,
  listSpools,
  modelGeometrySql,
  openRequestsForModel,
  printStats,
  printSuggestions,
  slicersFor,
  spoolmanEnabled,
} from '@pb/core'
import { PageHeader } from '@/components/shell/page-header'
import { Breadcrumbs } from '@/components/shell/breadcrumbs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { AutoRefresh } from '@/components/ui/auto-refresh'
import { Callout } from '@/components/ui/callout'
import { SectionHeader } from '@/components/ui/section-header'
import { formatBytes, formatDimensions } from '@/components/model/model-card'
import { ModelPreview } from '@/components/viewer/model-preview'
import { DownloadModelButton } from './download-button'
import { ModelEditor } from './model-editor'
import { FileSection } from './file-tree'
import { PrintHistory } from './print-history'
import { MoreActions } from './more-actions'
import { LikeButton } from './like-button'
import { CollectionPicker } from './collection-picker'
import { QueueButton } from './queue-button'

export const dynamic = 'force-dynamic'

const RENDERING_REFRESH_MS = 5_000
const PRINTING_REFRESH_MS = 30_000

type ModelDetail = {
  id: string
  library_id: string
  public_id: string
  name: string
  path: string
  notes: string | null
  license: string | null
  license_url: string | null
  license_expires_at: string | null
  commercial_use: boolean | null
  license_notes: string | null
  file_count: number
  total_size: string
  is_file_model: boolean
  is_package: boolean
  missing_at: string | null
  share_token: string | null
  preview_file_id: string | null
  bbox_x: string | null
  bbox_y: string | null
  bbox_z: string | null
  library_name: string
  library_path: string
  /** Only a library this app owns may have its files deleted. */
  library_writable: boolean
}

type PackageRelation = {
  public_id: string
  name: string
  path: string
  file_count: number
  total_size: string
}

type ModelLink = {
  url: string
  title: string | null
  host: string | null
}

type FileRow = {
  id: string
  filename: string
  extension: string
  category: string
  size: string
  previewable: boolean
  presupported: boolean
  missing_at: string | null
  thumb_state: string
  thumb_key: string | null
  triangle_count: number | null
  bbox_x: string | null
  bbox_y: string | null
  bbox_z: string | null
}

export async function generateMetadata({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params
  const result = await getDb().execute<{ name: string }>(
    sql`SELECT name FROM models WHERE public_id = ${publicId} LIMIT 1`,
  )
  return { title: result.rows[0]?.name ?? 'Model' }
}

export default async function ModelPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params
  const db = getDb()

  const models = await db.execute<ModelDetail>(sql`
    SELECT m.id, m.library_id, m.public_id, m.name, m.path, m.notes, m.license,
           m.license_url, m.license_expires_at, m.commercial_use, m.license_notes,
           m.file_count, m.total_size, m.is_file_model, m.is_package,
           m.missing_at, m.share_token,
           m.preview_file_id,
           geometry.bbox_x, geometry.bbox_y, geometry.bbox_z,
           l.name AS library_name, l.path AS library_path,
           (l.kind = 'managed' OR l.allow_writes) AS library_writable
    FROM models m JOIN libraries l ON l.id = m.library_id
    LEFT JOIN LATERAL (${modelGeometrySql(sql`m.id`, sql`m.preview_file_id`)}) geometry ON true
    WHERE m.public_id = ${publicId} LIMIT 1
  `)

  const model = models.rows[0]
  if (!model) notFound()

  const packageChildren = model.is_package
    ? await db.execute<PackageRelation>(sql`
        SELECT public_id, name, path, file_count, total_size
        FROM models
        WHERE library_id = ${model.library_id}
          AND id <> ${model.id}
          AND missing_at IS NULL
          AND starts_with(path, ${`${model.path}/`})
        ORDER BY path
      `)
    : { rows: [] as PackageRelation[] }

  const parentPackage = !model.is_package
    ? (
        await db.execute<{ public_id: string; name: string }>(sql`
          SELECT public_id, name
          FROM models
          WHERE library_id = ${model.library_id}
            AND is_package = true
            AND missing_at IS NULL
            AND starts_with(${model.path}, path || '/')
          ORDER BY length(path) DESC
          LIMIT 1
        `)
      ).rows[0]
    : undefined

  const files = await db.execute<FileRow>(sql`
    SELECT id, filename, extension, category, size, previewable, presupported, missing_at,
           thumb_state, thumb_key, triangle_count, bbox_x, bbox_y, bbox_z
    FROM model_files WHERE model_id = ${model.id}
    ORDER BY category, filename
  `)

  const modelLinks = await db.execute<ModelLink>(sql`
    SELECT url, title, host
    FROM model_links
    WHERE model_id = ${model.id}
    ORDER BY position, id
  `)

  // Links are typed in by people and imported from other sites, so only web
  // addresses become anchors; the editor still gets every row to fix them.
  const safeLinks = modelLinks.rows.filter((link) => {
    try {
      return ['https:', 'http:'].includes(new URL(link.url).protocol)
    } catch {
      return false
    }
  })
  const sourceLink = safeLinks.find((link) => link.title === 'Original model page')
  const additionalLinks = safeLinks.filter((link) => link !== sourceLink)

  // Grouping by category makes a 40-file model legible; a flat list does not.
  const byCategory = new Map<string, FileRow[]>()
  for (const file of files.rows) {
    const list = byCategory.get(file.category) ?? []
    list.push(file)
    byCategory.set(file.category, list)
  }

  const CATEGORY_ORDER = ['model', 'image', 'slicer', 'document', 'archive', 'video', 'other']
  const CATEGORY_LABELS: Record<string, string> = {
    model: '3D models',
    image: 'Images',
    slicer: 'Sliced files',
    document: 'Documents',
    archive: 'Archives',
    video: 'Video',
    other: 'Other',
  }

  const presupportedCount = files.rows.filter((f) => f.presupported).length

  const meta = await db.execute<{
    creator: string | null
    creator_slug: string | null
    tags: { name: string; slug: string }[] | null
  }>(sql`
    SELECT c.name AS creator, c.slug AS creator_slug,
           (SELECT json_agg(json_build_object('name', t.name, 'slug', t.slug) ORDER BY t.name)
              FROM model_tags mt
              JOIN tags t ON t.id = mt.tag_id WHERE mt.model_id = m.id) AS tags
    FROM models m LEFT JOIN creators c ON c.id = m.creator_id
    WHERE m.id = ${model.id}
  `)
  const creator = meta.rows[0]?.creator ?? null
  const creatorSlug = meta.rows[0]?.creator_slug ?? null
  const tags = meta.rows[0]?.tags ?? []

  const user = await getSessionUser()
  const policyUser = { id: user?.id ?? '', role: user?.role ?? null }
  const canEdit = can(policyUser, 'model:edit')
  const canLogPrints = can(policyUser, 'print:log')
  const canSend = can(policyUser, 'printhost:send')

  const canQueue = can(policyUser, 'request:create')

  const [prints, stats, suggestions, settings, memberships, liked, queued, spools, filaments] =
    await Promise.all([
      listPrints(db, { modelId: model.id, limit: 50 }),
      printStats(db, model.id),
      printSuggestions(db),
      getSettings(db),
      collectionsForModel(db, model.id),
      user ? isLiked(db, user.id, model.id) : Promise.resolve(false),
      canQueue ? openRequestsForModel(db, model.id) : Promise.resolve([]),
      canLogPrints && !spoolmanEnabled() ? listSpools(db) : Promise.resolve([]),
      canQueue ? filamentOptions(db) : Promise.resolve([]),
    ])

  /*
   * Keep the page current while something on it is still changing: files the
   * worker is making previews for (quickly — someone just added them and is
   * waiting), or a print still running on a printer (slowly).
   */
  const rendering = files.rows.some((f) => f.thumb_state === 'pending' && !f.missing_at)
  const printing = prints.some((print) => print.status === 'in_progress')

  // The same test listMoveTargets starts with, so "Move to library…" is only
  // offered when there is a library that could take the model.
  const canMoveSomewhere =
    canEdit &&
    !model.is_package &&
    (
      await db.execute<{ one: number }>(sql`
        SELECT 1 AS one FROM libraries
        WHERE id <> ${model.library_id}
          AND (kind = 'managed' OR allow_writes)
          AND (CASE WHEN backend = 's3' THEN NULLIF(s3_bucket, '') IS NOT NULL ELSE NULLIF(path, '') IS NOT NULL END)
        LIMIT 1
      `)
    ).rows.length > 0

  const canCollect = can(policyUser, 'collection:edit')
  const allCollections = canCollect ? await listCollections(db) : []

  // The largest rendered mesh represents the model, and its dimensions are the
  // ones worth showing — a support-only variant is not what people measure.
  // A slicer's embedded preview only stands in when nothing else rendered.
  const hero = files.rows
    .filter((f) => f.thumb_state === 'ok' && !f.missing_at)
    .sort(
      (a, b) =>
        Number(a.category === 'slicer') - Number(b.category === 'slicer') ||
        Number(b.size) - Number(a.size),
    )[0]

  const selectedPreview = model.preview_file_id
    ? files.rows.find((file) => file.id === model.preview_file_id && !file.missing_at)
    : undefined
  const selectedImage = selectedPreview?.category === 'image' ? selectedPreview : undefined

  const heroDimensions = formatDimensions(
    Number(model.bbox_x ?? 0),
    Number(model.bbox_y ?? 0),
    Number(model.bbox_z ?? 0),
  )

  const licenceExpiry = model.license_expires_at
    ? (() => {
        const parts = model.license_expires_at.split('-')
        const year = Number(parts[0])
        const month = Number(parts[1])
        const day = Number(parts[2])
        const expiresAt = Date.UTC(year, month - 1, day)
        const now = new Date()
        const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
        const daysRemaining = Math.floor((expiresAt - today) / 86_400_000)

        return {
          label: new Intl.DateTimeFormat('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            timeZone: 'UTC',
          }).format(new Date(expiresAt)),
          expired: daysRemaining < 0,
          expiringSoon: daysRemaining >= 0 && daysRemaining <= 30,
        }
      })()
    : null

  /*
   * The viewer needs a mesh we can parse in the browser, which is not
   * necessarily the file chosen as the preview — that may well be an image the
   * creator supplied. Largest wins: a support-only variant is rarely the one
   * someone wants to inspect.
   */
  const VIEWABLE = new Set(['stl', '3mf', 'obj', 'ply'])
  const viewable = files.rows
    .filter((f) => !f.missing_at && VIEWABLE.has(f.extension.toLowerCase()))
    .sort((a, b) => Number(b.size) - Number(a.size))[0]

  /*
   * Built here rather than in the client component: only the server knows the
   * configured public address, and a link built from window.location would be
   * wrong behind a proxy.
   */
  const requestHeaders = await headers()
  const appOrigin =
    process.env.APP_URL?.replace(/\/+$/, '') ??
    `${requestHeaders.get('x-forwarded-proto') ?? 'http'}://${
      requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? 'localhost:3000'
    }`

  return (
    <>
      {(rendering || printing) && (
        <AutoRefresh intervalMs={rendering ? RENDERING_REFRESH_MS : PRINTING_REFRESH_MS} />
      )}
      <Breadcrumbs
        items={[
          { label: 'Models', href: '/models' },
          ...(parentPackage
            ? [{ label: parentPackage.name, href: `/models/${parentPackage.public_id}` }]
            : []),
        ]}
      />

      <PageHeader
        title={model.name}
        actions={
          model.missing_at ? (
            <Badge tone="danger">Missing from disk</Badge>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              {model.is_package && (
                <Badge tone="accent">
                  <Package className="size-3" />
                  Package
                </Badge>
              )}
              <Badge tone="neutral">
                <FileStack className="size-3" />
                {model.file_count} {model.file_count === 1 ? 'file' : 'files'} ·{' '}
                {formatBytes(Number(model.total_size))}
              </Badge>
              {user && <LikeButton publicId={model.public_id} liked={liked} />}
              {canQueue && !model.is_package && (
                <QueueButton
                  modelId={model.id}
                  modelPublicId={model.public_id}
                  modelName={model.name}
                  openCount={queued.length}
                  files={files.rows
                    .filter(
                      (file) =>
                        !file.missing_at &&
                        (file.category === 'model' || file.category === 'slicer'),
                    )
                    .map((file) => ({
                      id: file.id,
                      filename: file.filename,
                      category: file.category as 'model' | 'slicer',
                    }))}
                  filaments={filaments}
                />
              )}
              {canCollect && (
                <CollectionPicker
                  publicId={model.public_id}
                  collections={allCollections.map((c) => ({ id: c.id, name: c.name }))}
                  memberOf={memberships.map((c) => c.id)}
                />
              )}
              <ModelEditor
                publicId={model.public_id}
                canEdit={canEdit}
                initial={{
                  name: model.name,
                  notes: model.notes,
                  license: model.license,
                  licenseUrl: model.license_url,
                  licenseExpiresAt: model.license_expires_at,
                  commercialUse: model.commercial_use,
                  licenseNotes: model.license_notes,
                  creator,
                  tags: tags.map((tag) => tag.name),
                  links: modelLinks.rows.map((link) => ({
                    title: link.title,
                    url: link.url,
                  })),
                }}
              />
              <DownloadModelButton publicId={model.public_id} />
              <MoreActions
                model={{
                  publicId: model.public_id,
                  name: model.name,
                  libraryName: model.library_name,
                }}
                share={
                  settings.publicSharing && canEdit && !model.is_package
                    ? {
                        shareUrl: model.share_token
                          ? `${appOrigin}/share/${model.share_token}`
                          : null,
                      }
                    : undefined
                }
                addFiles={
                  model.library_writable && can(policyUser, 'file:upload')
                    ? {
                        modelId: model.id,
                        libraryId: model.library_id,
                        isFileModel: model.is_file_model,
                        fileName: model.path.split('/').pop() ?? model.name,
                      }
                    : undefined
                }
                canMove={canMoveSomewhere}
                remove={
                  can(policyUser, 'model:delete') && !model.is_package
                    ? { fileCount: model.file_count, canDeleteFiles: model.library_writable }
                    : undefined
                }
              />
            </div>
          )
        }
      />

      {model.missing_at && (
        <Callout
          tone="danger"
          icon={<AlertTriangle />}
          title="This model was not found during the last scan."
          className="mb-6"
        >
          <p className="text-[var(--color-ink-muted)]">
            Its record is kept for 30 days in case the folder comes back. Nothing has been deleted.
            If the drive is unmounted, remount it and scan again.
          </p>
        </Callout>
      )}

      {/*
        min-w-0 on both columns: a grid item's automatic minimum size is its
        min-content width, and a full path like
        "presupported/dragon_knight_body_v3_final.stl" has no break opportunity
        — without this the column grows to fit it and the page scrolls
        sideways on a phone, however much the file rows truncate.
      */}
      <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
        <div className="min-w-0 space-y-6">
          {(viewable || selectedImage || hero) && (
            <ModelPreview
              key={model.public_id}
              name={model.name}
              imageUrl={
                selectedImage
                  ? `/api/files/${selectedImage.id}/raw?inline=1`
                  : hero
                    ? `/api/files/${hero.id}/thumb?v=${encodeURIComponent(hero.thumb_key ?? '')}`
                    : null
              }
              model={
                viewable
                  ? {
                      fileId: viewable.id,
                      format: viewable.extension.toLowerCase() as 'stl' | '3mf' | 'obj' | 'ply',
                      fileSize: Number(viewable.size),
                      filename: viewable.filename.split('/').pop() ?? viewable.filename,
                      thumbnailFileId: hero?.id ?? null,
                      thumbnailKey: hero?.thumb_key ?? null,
                      maxBytes: settings.viewerMaxBytes,
                    }
                  : null
              }
            />
          )}

          {model.notes && (
            <Card>
              <details className="p-4">
                <summary className="cursor-pointer text-sm font-semibold">
                  Description and notes
                </summary>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-[var(--color-ink-muted)]">
                  {model.notes}
                </p>
              </details>
            </Card>
          )}

          {model.is_package && packageChildren.rows.length > 0 && (
            <section>
              <SectionHeader
                icon={<Boxes />}
                title={
                  <SectionCount
                    label="Models in this package"
                    count={packageChildren.rows.length}
                  />
                }
              />
              <Card className="overflow-hidden">
                <ul className="divide-y divide-[var(--color-border)]">
                  {packageChildren.rows.map((child) => (
                    <li key={child.public_id}>
                      <Link
                        href={`/models/${child.public_id}` as Route}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--color-surface-2)]"
                      >
                        <Box className="size-4 shrink-0 text-[var(--color-ink-faint)]" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{child.name}</span>
                          <span className="block truncate text-xs text-[var(--color-ink-faint)]">
                            {child.path.slice(model.path.length + 1)}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-[var(--color-ink-muted)]">
                          {child.file_count} {child.file_count === 1 ? 'file' : 'files'} ·{' '}
                          {formatBytes(Number(child.total_size))}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}

          {CATEGORY_ORDER.filter((category) => byCategory.has(category)).map((category) => (
            <FileSection
              key={category}
              icon={category === 'model' ? <Box /> : <Layers />}
              title={
                <SectionCount
                  label={CATEGORY_LABELS[category] ?? category}
                  count={byCategory.get(category)!.length}
                />
              }
              files={byCategory.get(category)!.map((file) => ({
                id: file.id,
                filename: file.filename,
                extension: file.extension,
                size: file.size,
                presupported: file.presupported,
                missing_at: file.missing_at,
                triangle_count: file.triangle_count,
                canOpenInSlicer: slicersFor(file.extension).length > 0,
                canSendToPrinter: canSend && canSendToPrinter(file.extension),
                thumbUrl:
                  file.category === 'slicer' && file.thumb_state === 'ok' && file.thumb_key
                    ? `/api/files/${file.id}/thumb?v=${encodeURIComponent(file.thumb_key)}`
                    : null,
              }))}
            />
          ))}

          {!model.is_package && (
            <PrintHistory
              publicId={model.public_id}
              canLog={canLogPrints}
              files={files.rows
                .filter((file) => !file.missing_at)
                .map((file) => ({ id: file.id, filename: file.filename }))}
              suggestions={suggestions}
              spools={spools}
              spoolInventory={!spoolmanEnabled()}
              stats={{
                ...stats,
                lastPrintedAt: stats.lastPrintedAt?.toISOString() ?? null,
              }}
              prints={prints.map((print) => ({
                ...print,
                startedAt: print.startedAt?.toISOString() ?? null,
                finishedAt: print.finishedAt?.toISOString() ?? null,
                createdAt: print.createdAt.toISOString(),
              }))}
            />
          )}
        </div>

        <aside className="min-w-0 space-y-4">
          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle>Model information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-0 text-sm">
              <Meta label="Library">
                <span className="flex items-center gap-1.5">
                  <HardDrive className="size-3.5 text-[var(--color-ink-faint)]" />
                  {model.library_name}
                </span>
              </Meta>

              <Meta label="Folder">
                <span className="flex items-start gap-1.5 break-all font-mono text-xs">
                  <FolderOpen className="mt-0.5 size-3.5 shrink-0 text-[var(--color-ink-faint)]" />
                  {model.path}
                </span>
              </Meta>

              {heroDimensions && (
                <Meta label="Dimensions">
                  <span className="tabular-nums">{heroDimensions}</span>
                </Meta>
              )}

              {presupportedCount > 0 && (
                <Meta label="Supports">{presupportedCount} pre-supported files</Meta>
              )}

              {creator && (
                <Meta label="Creator">
                  {creatorSlug ? (
                    <Link
                      href={`/creators/${creatorSlug}` as Route}
                      className="text-[var(--color-accent)] hover:underline"
                    >
                      {creator}
                    </Link>
                  ) : (
                    creator
                  )}
                </Meta>
              )}

              {sourceLink && (
                <Meta label="Source">
                  <ExternalLink link={sourceLink} />
                </Meta>
              )}

              {memberships.length > 0 && (
                <Meta label="Collections">
                  <span className="flex flex-wrap gap-1">
                    {memberships.map((collection) => (
                      <Link key={collection.id} href={`/collections/${collection.slug}` as Route}>
                        <Badge className="hover:text-[var(--color-ink)]">{collection.name}</Badge>
                      </Link>
                    ))}
                  </span>
                </Meta>
              )}

              {tags.length > 0 && (
                <Meta label="Tags">
                  <span className="flex flex-wrap gap-1">
                    {tags.map((tag) => (
                      <Link key={tag.slug} href={`/tags/${tag.slug}` as Route}>
                        <Badge className="hover:text-[var(--color-ink)]">{tag.name}</Badge>
                      </Link>
                    ))}
                  </span>
                </Meta>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle>Licence</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-0 text-sm">
              {model.license_url ? (
                <a
                  href={model.license_url}
                  target="_blank"
                  rel="noreferrer"
                  className="block break-words text-[var(--color-accent)] hover:underline"
                >
                  {model.license ?? 'View licence'}
                </a>
              ) : (
                <p className="text-[var(--color-ink-muted)]">{model.license ?? 'Not recorded'}</p>
              )}

              {/* With nothing recorded at all, one "Not recorded" says it. */}
              {(model.commercial_use != null || model.license || model.license_url) && (
                <Meta label="Commercial use">
                  <span
                    className={
                      model.commercial_use === true
                        ? 'text-[var(--color-success)]'
                        : model.commercial_use === false
                          ? 'text-[var(--color-danger)]'
                          : 'text-[var(--color-ink-muted)]'
                    }
                  >
                    {model.commercial_use === true
                      ? 'Licensed'
                      : model.commercial_use === false
                        ? 'Not permitted'
                        : 'Not recorded'}
                  </span>
                </Meta>
              )}

              {licenceExpiry && (
                <Meta label="Expiry">
                  <span
                    className={
                      licenceExpiry.expired
                        ? 'text-[var(--color-danger)]'
                        : licenceExpiry.expiringSoon
                          ? 'text-[var(--color-warning)]'
                          : undefined
                    }
                  >
                    {licenceExpiry.label}
                    {licenceExpiry.expired
                      ? ' — Expired'
                      : licenceExpiry.expiringSoon
                        ? ' — Expiring soon'
                        : ''}
                  </span>
                </Meta>
              )}

              {model.license_notes && (
                <Meta label="Notes">
                  <span className="whitespace-pre-wrap break-words text-[var(--color-ink-muted)]">
                    {model.license_notes}
                  </span>
                </Meta>
              )}
            </CardContent>
          </Card>

          {additionalLinks.length > 0 && (
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle>Links</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 p-4 pt-0 text-sm">
                {additionalLinks.map((link) => (
                  <ExternalLink key={link.url} link={link} />
                ))}
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </>
  )
}

/** One labelled fact in the sidebar: a small caps label over its value. */
function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">
        {label}
      </p>
      <div className="mt-0.5">{children}</div>
    </div>
  )
}

/** A section title with its item count beside it, quieter than the title. */
function SectionCount({ label, count }: { label: string; count: number }) {
  return (
    <>
      {label}
      <span className="font-normal text-[var(--color-ink-faint)]">{count}</span>
    </>
  )
}

function ExternalLink({ link }: { link: ModelLink }) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block break-words text-[var(--color-accent)] hover:underline"
    >
      {link.title ?? link.host ?? new URL(link.url).hostname}
    </a>
  )
}
