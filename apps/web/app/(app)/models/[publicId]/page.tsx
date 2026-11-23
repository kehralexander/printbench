import type { ReactNode } from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { sql } from 'drizzle-orm'
import { AlertTriangle, Box, Boxes, FolderOpen, HardDrive, Package } from 'lucide-react'
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
  formatMoney,
  hasSlicerThumbnail,
  modelPriceEstimate,
  printSuggestions,
  slicersFor,
  spoolmanEnabled,
  type SlicerFileMeta,
} from '@pb/core'
import { Breadcrumbs } from '@/components/shell/breadcrumbs'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { AutoRefresh } from '@/components/ui/auto-refresh'
import { Callout } from '@/components/ui/callout'
import { SectionHeader } from '@/components/ui/section-header'
import { formatBytes, formatDimensions } from '@/components/model/model-card'
import { formatDate, formatDuration, formatGrams } from '@/lib/format'
import { DownloadModelButton } from './download-button'
import { ModelEditor } from './model-editor'
import { FilesTable } from './files-table'
import { slicerSummary } from './slicer-summaries'
import { PlateStrip, type Plate } from './plate-strip'
import { PreviewProvider, type PreviewItem } from './preview-context'
import { PreviewRail } from './preview-rail'
import { ClampedNotes } from './clamped-notes'
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
  slicer_meta: SlicerFileMeta | null
  slicer_meta_error: string | null
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
           thumb_state, thumb_key, triangle_count, slicer_meta, slicer_meta_error, bbox_x, bbox_y, bbox_z
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
  // Imported or hand-edited sidecars can carry more than one original page;
  // the extras would all read "Original model page", so name them by site.
  const additionalLinks = safeLinks
    .filter((link) => link !== sourceLink)
    .map((link) =>
      link.title === 'Original model page'
        ? { ...link, title: link.host?.replace(/^www\./i, '') ?? null }
        : link,
    )

  const presupportedCount = files.rows.filter((f) => f.presupported).length

  const fileThumbUrl = (file: FileRow) =>
    file.category === 'slicer' && file.thumb_state === 'ok' && file.thumb_key
      ? `/api/files/${file.id}/thumb?v=${encodeURIComponent(file.thumb_key)}`
      : null

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

  // Sliced G-code, as prints rather than files: what the plates table compares.
  const plates: Plate[] = files.rows
    .filter(
      (file) =>
        file.category === 'slicer' && !file.missing_at && hasSlicerThumbnail(file.extension),
    )
    .map((file) => ({
      id: file.id,
      filename: file.filename,
      thumbUrl: fileThumbUrl(file),
      canOpenInSlicer: slicersFor(file.extension).length > 0,
      canSendToPrinter: canSend && canSendToPrinter(file.extension),
      slicer: slicerSummary(file.slicer_meta),
      readFailed: file.slicer_meta_error != null,
      printed: 0,
    }))

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

  // "≈ €3.20 to print": what asking for one copy would come to, from its sliced files.
  const priceEstimate =
    canQueue && !model.is_package && settings.pricing.enabled
      ? await modelPriceEstimate(db, model.id, settings.pricing)
      : null

  const canCollect = can(policyUser, 'collection:edit')
  const allCollections = canCollect ? await listCollections(db) : []

  // The largest rendered mesh represents the model, and its dimensions are the
  // ones worth showing — a support-only variant is not what people measure.
  // A slicer's embedded preview only stands in when nothing else rendered.
  const hero = files.rows
    .filter((f) => f.thumb_state === 'ok' && !f.missing_at)
    .sort(
      (a, b) =>
        Number(b.id === model.preview_file_id) - Number(a.id === model.preview_file_id) ||
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

  // A plate counts as printed when a logged print names its file.
  for (const plate of plates) {
    plate.printed = prints.filter(
      (print) => print.filename === plate.filename && print.status === 'success',
    ).length
  }

  /*
   * What the rail can show: every mesh the browser can parse, and every image.
   * The files table hands one of these to the rail when its row is picked.
   */
  const previewItems: PreviewItem[] = files.rows
    .filter(
      (file) =>
        !file.missing_at &&
        (VIEWABLE.has(file.extension.toLowerCase()) || file.category === 'image'),
    )
    .map((file) => {
      const mesh = VIEWABLE.has(file.extension.toLowerCase())
      return {
        id: file.id,
        filename: file.filename,
        kind: mesh ? ('mesh' as const) : ('image' as const),
        format: mesh ? (file.extension.toLowerCase() as PreviewItem['format']) : undefined,
        size: Number(file.size),
        triangles: file.triangle_count,
        dimensions: formatDimensions(
          Number(file.bbox_x ?? 0),
          Number(file.bbox_y ?? 0),
          Number(file.bbox_z ?? 0),
        ),
        imageUrl: mesh
          ? file.thumb_state === 'ok' && file.thumb_key
            ? `/api/files/${file.id}/thumb?v=${encodeURIComponent(file.thumb_key)}`
            : null
          : `/api/files/${file.id}/raw?inline=1`,
        canOpenInSlicer: slicersFor(file.extension).length > 0,
      }
    })

  const artwork = selectedImage
    ? {
        url: `/api/files/${selectedImage.id}/raw?inline=1`,
        fileId: selectedImage.id,
        filename: selectedImage.filename,
      }
    : hero
      ? {
          url: `/api/files/${hero.id}/thumb?v=${encodeURIComponent(hero.thumb_key ?? '')}`,
          fileId: hero.id,
          filename: hero.filename,
        }
      : null

  // The headline figures: what printing it takes, and what has happened so far.
  const timedPlates = plates.filter((plate) => plate.slicer?.durationMin != null)
  const plateMinutes = timedPlates.reduce((sum, p) => sum + (p.slicer?.durationMin ?? 0), 0)
  const plateGrams = plates.reduce((sum, p) => sum + (p.slicer?.filamentUsedG ?? 0), 0)
  const plateMaterials = [
    ...new Set(plates.map((plate) => plate.slicer?.material).filter(Boolean)),
  ].join(', ')
  const kpis: { label: string; value: string; sub?: string; title?: string }[] = [
    ...(timedPlates.length > 0
      ? [
          {
            label: 'Print time',
            value: formatDuration(plateMinutes),
            sub: `${plates.length} ${plates.length === 1 ? 'plate' : 'plates'}`,
          },
        ]
      : []),
    ...(plateGrams > 0
      ? [{ label: 'Filament', value: formatGrams(plateGrams), sub: plateMaterials || undefined }]
      : []),
    ...(priceEstimate
      ? [
          {
            label: 'Cost',
            value:
              priceEstimate.min === priceEstimate.max
                ? formatMoney(priceEstimate.min, settings.pricing.currency)
                : `${formatMoney(priceEstimate.min, settings.pricing.currency)}–${formatMoney(priceEstimate.max, settings.pricing.currency)}`,
            sub: 'one copy',
            title: `One copy at ${priceEstimate.tier} rates, from the sliced ${
              priceEstimate.plates === 1 ? 'file' : 'files'
            }`,
          },
        ]
      : []),
    ...(heroDimensions ? [{ label: 'Dimensions', value: heroDimensions }] : []),
    {
      label: 'Files',
      value: String(model.file_count),
      sub: formatBytes(Number(model.total_size)),
    },
    ...(!model.is_package
      ? [
          {
            label: 'Printed',
            value: `${stats.total}×`,
            sub: stats.lastPrintedAt ? `last ${formatDate(stats.lastPrintedAt)}` : undefined,
          },
        ]
      : []),
    ...(queued.length > 0 ? [{ label: 'Queued', value: `${queued.length}×` }] : []),
  ]

  const queueProps =
    canQueue && !model.is_package
      ? {
          modelId: model.id,
          modelPublicId: model.public_id,
          modelName: model.name,
          openCount: queued.length,
          files: files.rows
            .filter(
              (file) =>
                !file.missing_at && (file.category === 'model' || file.category === 'slicer'),
            )
            .map((file) => ({
              id: file.id,
              filename: file.filename,
              category: file.category as 'model' | 'slicer',
            })),
          filaments,
        }
      : null

  const licence = model.license_url ? (
    <a
      href={model.license_url}
      target="_blank"
      rel="noreferrer"
      className="text-[var(--color-accent)] hover:underline"
    >
      {model.license ?? 'Licence'}
    </a>
  ) : (
    model.license
  )
  const byline = [
    creator ? (
      <span key="creator">
        by{' '}
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
      </span>
    ) : null,
    sourceLink ? (
      <span key="source">
        from{' '}
        <a
          href={sourceLink.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--color-accent)] hover:underline"
        >
          {sourceLink.host?.replace(/^www\./i, '') ?? 'the original page'}
        </a>
      </span>
    ) : null,
    licence ? <span key="licence">{licence}</span> : null,
  ].filter(Boolean)

  return (
    <PreviewProvider
      items={previewItems}
      initialMeshId={viewable?.id ?? null}
      hasArtwork={artwork != null}
    >
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

      <Card className="mb-6 p-5">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1 basis-80">
            <h1 className="break-words text-2xl font-semibold tracking-tight">{model.name}</h1>
            {byline.length > 0 && (
              <p className="mt-1 flex flex-wrap gap-x-1.5 text-sm text-[var(--color-ink-muted)]">
                {byline.map((part, index) => (
                  <span key={index} className="flex gap-x-1.5">
                    {index > 0 && <span aria-hidden>·</span>}
                    {part}
                  </span>
                ))}
              </p>
            )}
          </div>
          {model.missing_at ? (
            <Badge tone="danger">Missing from disk</Badge>
          ) : (
            <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
              {model.is_package && (
                <Badge tone="accent">
                  <Package className="size-3" />
                  Package
                </Badge>
              )}
              {user && <LikeButton publicId={model.public_id} liked={liked} />}
              {queueProps && <QueueButton {...queueProps} />}
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
          )}
        </header>

        <dl className="mt-4 flex flex-wrap gap-x-10 gap-y-3 border-t border-[var(--color-border)] pt-4">
          {kpis.map((kpi) => (
            <div key={kpi.label} title={kpi.title} className="min-w-0">
              <dt className="text-xs uppercase tracking-wider text-[var(--color-ink-faint)]">
                {kpi.label}
              </dt>
              <dd className="whitespace-nowrap text-lg font-semibold tabular-nums leading-snug">
                {kpi.value}
              </dd>
              {kpi.sub && <dd className="text-xs text-[var(--color-ink-faint)]">{kpi.sub}</dd>}
            </div>
          ))}
        </dl>
      </Card>

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
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_480px]">
        <div className="min-w-0 space-y-8">
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

          {plates.length > 0 && (
            <PlateStrip publicId={model.public_id} plates={plates} queue={queueProps} />
          )}

          {files.rows.length > 0 && (
            <FilesTable
              permissions={{
                renamePublicId: canEdit && model.library_writable ? model.public_id : null,
                deletePublicId:
                  can(policyUser, 'model:delete') &&
                  model.library_writable &&
                  !model.is_file_model &&
                  !model.is_package
                    ? model.public_id
                    : null,
                thumbnailPublicId: canEdit ? model.public_id : null,
              }}
              files={files.rows.map((file) => ({
                id: file.id,
                filename: file.filename,
                extension: file.extension,
                category: file.category,
                size: file.size,
                presupported: file.presupported,
                missing_at: file.missing_at,
                triangle_count: file.triangle_count,
                canOpenInSlicer: slicersFor(file.extension).length > 0,
                canSendToPrinter: canSend && canSendToPrinter(file.extension),
                thumbUrl:
                  file.thumb_state === 'ok' && file.thumb_key
                    ? `/api/files/${file.id}/thumb?v=${encodeURIComponent(file.thumb_key)}`
                    : null,
                canBeThumbnail:
                  !file.missing_at && (file.category === 'image' || file.thumb_state === 'ok'),
                isThumbnail: file.id === model.preview_file_id,
              }))}
            />
          )}

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

        {/* First on a phone, where the picture is what tells you which model this is. */}
        <aside className="order-first min-w-0 space-y-4 lg:sticky lg:top-6 lg:order-none lg:self-start">
          <PreviewRail
            name={model.name}
            artwork={artwork}
            thumbnail={hero ? { fileId: hero.id, key: hero.thumb_key } : null}
            maxBytes={settings.viewerMaxBytes}
          />

          <Card className="space-y-4 p-4 text-sm">
            <div className="space-y-2">
              <h2 className="text-sm font-semibold">About</h2>
              {model.notes ? (
                <ClampedNotes text={model.notes} />
              ) : (
                <p className="text-[var(--color-ink-faint)]">No description.</p>
              )}
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {tags.map((tag) => (
                    <Link key={tag.slug} href={`/tags/${tag.slug}` as Route}>
                      <Badge className="hover:text-[var(--color-ink)]">{tag.name}</Badge>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 border-t border-[var(--color-border)] pt-3 text-xs">
              <Fact label="Library">
                <span className="flex items-center gap-1.5">
                  <HardDrive className="size-3.5 shrink-0 text-[var(--color-ink-faint)]" />
                  {model.library_name}
                </span>
              </Fact>
              <Fact label="Folder">
                <span className="flex items-start gap-1.5 break-all font-mono">
                  <FolderOpen className="size-3.5 shrink-0 text-[var(--color-ink-faint)]" />
                  {model.path}
                </span>
              </Fact>
              {presupportedCount > 0 && (
                <Fact label="Supports">{presupportedCount} pre-supported files</Fact>
              )}
              {memberships.length > 0 && (
                <Fact label="Collections">
                  <span className="flex flex-wrap gap-1">
                    {memberships.map((collection) => (
                      <Link key={collection.id} href={`/collections/${collection.slug}` as Route}>
                        <Badge className="hover:text-[var(--color-ink)]">{collection.name}</Badge>
                      </Link>
                    ))}
                  </span>
                </Fact>
              )}
              <Fact label="Licence">
                {licence ?? <span className="text-[var(--color-ink-muted)]">Not recorded</span>}
              </Fact>
              {/* With nothing recorded at all, one "Not recorded" says it. */}
              {(model.commercial_use != null || model.license || model.license_url) && (
                <Fact label="Commercial use">
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
                </Fact>
              )}
              {licenceExpiry && (
                <Fact label="Expiry">
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
                </Fact>
              )}
              {model.license_notes && (
                <Fact label="Licence notes">
                  <span className="whitespace-pre-wrap break-words text-[var(--color-ink-muted)]">
                    {model.license_notes}
                  </span>
                </Fact>
              )}
              {sourceLink && (
                <Fact label="Source">
                  <ExternalLink link={sourceLink} />
                </Fact>
              )}
              {additionalLinks.length > 0 && (
                <Fact label="Links">
                  <span className="space-y-1">
                    {additionalLinks.map((link) => (
                      <ExternalLink key={link.url} link={link} />
                    ))}
                  </span>
                </Fact>
              )}
            </dl>
          </Card>
        </aside>
      </div>
    </PreviewProvider>
  )
}

/** One labelled fact in the rail: a quiet label beside its value. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-[var(--color-ink-faint)]">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
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
