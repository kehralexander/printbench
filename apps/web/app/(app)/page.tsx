import Link from 'next/link'
import { sql } from 'drizzle-orm'
import { Boxes, ClipboardList, HardDrive, History, Printer, Wrench } from 'lucide-react'
import {
  can,
  listRequests,
  modelFormatSql,
  modelGeometrySql,
  modelThumbnailSql,
  printerSnapshots,
  printStats,
  unratedPrints,
  type PrinterSnapshot,
} from '@pb/core'
import { getSessionUser } from '@pb/auth'
import { getDb } from '@pb/db'
import { PageHeader } from '@/components/shell/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { ModelCard, formatDimensions } from '@/components/model/model-card'
import { ClockTime } from '@/components/ui/clock-time'
import { AutoRefresh } from '@/components/ui/auto-refresh'
import { LiveProgressBar } from '@/components/printer/live-progress'
import { UnratedPrints } from './prints/unrated-prints'

export const dynamic = 'force-dynamic'

/*
 * As often as the worker reads the printers (PRINTER_POLL_SECONDS, 20 by
 * default); sooner would only re-show the same reading. The bars tick on in
 * between.
 */
const PRINTER_REFRESH_MS = 20_000

async function counts() {
  const result = await getDb().execute<{
    libraries: number
    models: number
    files: number
    users: number
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM libraries)                              AS libraries,
      (SELECT count(*)::int FROM models WHERE missing_at IS NULL)        AS models,
      (SELECT count(*)::int FROM model_files WHERE missing_at IS NULL)   AS files,
      (SELECT count(*)::int FROM "user")                                 AS users
  `)
  return result.rows[0] ?? { libraries: 0, models: 0, files: 0, users: 0 }
}

type RecentModel = {
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

/** The newest models, with whichever of their files has a rendered thumbnail. */
async function recentModels(): Promise<RecentModel[]> {
  const result = await getDb().execute<RecentModel>(sql`
    SELECT m.public_id, m.name, m.path, m.file_count, m.total_size, m.is_package,
           l.name AS library_name,
           ${modelFormatSql(sql`m.id`, sql`m.preview_file_id`)} AS preview_extension,
           CASE WHEN selected.category = 'image' THEN selected.id END AS preview_image_file_id,
           thumb.id AS thumb_file_id, thumb.thumb_key,
           geometry.bbox_x, geometry.bbox_y, geometry.bbox_z
    FROM models m
    JOIN libraries l ON l.id = m.library_id
    LEFT JOIN model_files selected ON selected.id = m.preview_file_id
    LEFT JOIN LATERAL (${modelGeometrySql(sql`m.id`, sql`m.preview_file_id`)}) geometry ON true
    LEFT JOIN LATERAL (${modelThumbnailSql(sql`m.id`, sql`m.preview_file_id`)}) thumb ON true
    WHERE m.missing_at IS NULL
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 8
  `)
  return result.rows
}

type RecentPrint = {
  public_id: string
  model_name: string
  status: string
  printer_name: string | null
  material: string | null
  started_at: string | null
  created_at: string
}

async function recentPrints(): Promise<RecentPrint[]> {
  const result = await getDb().execute<RecentPrint>(sql`
    SELECT m.public_id, m.name AS model_name, p.status, p.printer_name, p.material,
           p.started_at, p.created_at
    FROM print_runs p JOIN models m ON m.id = p.model_id
    ORDER BY coalesce(p.started_at, p.created_at) DESC, p.created_at DESC
    LIMIT 6
  `)
  return result.rows
}

const NUMBER = new Intl.NumberFormat('en-GB')

/** A printer as the dashboard shows it, from the worker's last reading. */
interface PrinterLine {
  id: string
  name: string
  label: string
  tone: 'accent' | 'danger' | 'neutral'
  filename: string | null
  /** 0..1 */
  progress: number | null
  remainingSec: number | null
  /** How old the worker's reading was when this rendered. */
  ageSec: number
  paused: boolean
  /** ISO; when a running print should finish. */
  doneAt: string | null
}

/**
 * Read from the snapshots the worker keeps, never from the printers: a
 * switched-off printer must not hold up the page everyone lands on.
 */
async function printerLines(): Promise<PrinterLine[]> {
  const snapshots = await printerSnapshots(getDb())
  return snapshots.map(printerLine)
}

function printerLine(printer: PrinterSnapshot): PrinterLine {
  const status = printer.fresh ? printer.status : null
  const ageSec = printer.ageSec ?? 0
  const base = {
    id: printer.id,
    name: printer.name,
    filename: null,
    progress: null,
    remainingSec: null,
    ageSec,
    paused: false,
    doneAt: null,
  }
  if (!status)
    return {
      ...base,
      label: printer.status ? 'No recent reading' : 'Not read yet',
      tone: 'neutral',
    }
  if (status.state === 'offline' || status.state === 'error') {
    return { ...base, label: status.state === 'offline' ? 'Offline' : 'Error', tone: 'danger' }
  }
  if (!status.busy) return { ...base, label: 'Idle', tone: 'neutral' }
  return {
    ...base,
    label: status.state === 'paused' ? 'Paused' : 'Printing',
    tone: 'accent',
    filename: status.filename?.split('/').pop() ?? null,
    progress: status.progress ?? null,
    remainingSec: status.remainingSec ?? null,
    paused: status.state === 'paused',
    doneAt:
      status.state === 'printing' && status.remainingSec != null
        ? new Date(Date.now() + (status.remainingSec - ageSec) * 1000).toISOString()
        : null,
  }
}

function Stat({
  label,
  value,
  icon: Icon,
  href,
}: {
  label: string
  value: string
  icon: React.ComponentType<{ className?: string }>
  href?: '/models' | '/prints' | '/admin/libraries' | '/admin/users'
}) {
  const body = (
    <CardContent className="flex items-center gap-3 p-4">
      <span className="flex size-9 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-surface-2)] text-[var(--color-ink-faint)]">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-xl font-semibold tabular-nums leading-tight">{value}</p>
        <p className="truncate text-xs text-[var(--color-ink-muted)]">{label}</p>
      </div>
    </CardContent>
  )

  return href ? (
    <Card className="transition-shadow hover:shadow-[var(--shadow-card)]">
      <Link href={href}>{body}</Link>
    </Card>
  ) : (
    <Card>{body}</Card>
  )
}

export default async function DashboardPage() {
  const user = await getSessionUser()
  /*
   * The layout redirects when there is no session, but Next renders layout and
   * page concurrently — so this runs anyway, and asserting a user here throws
   * before the redirect lands. Rendering nothing is the honest answer.
   */
  if (!user) return null

  const policyUser = { id: user.id, role: user.role ?? 'viewer' }
  const canManage = can(policyUser, 'library:manage')

  const canQueue = can(policyUser, 'request:create')

  const canRate = can(policyUser, 'print:log')

  const [stats, prints, models, latestPrints, queued, printers, unrated] = await Promise.all([
    counts(),
    printStats(getDb()),
    recentModels(),
    recentPrints(),
    /*
     * Open requests, most urgent first. This is the one section that is a to-do
     * list rather than a record, so it sits above the rest — it is the reason
     * someone opens the dashboard before starting a print.
     */
    canQueue
      ? listRequests(getDb(), { status: ['requested', 'printing'], limit: 5 })
      : Promise.resolve([]),
    printerLines(),
    canRate ? unratedPrints(getDb(), 3) : Promise.resolve([]),
  ])

  return (
    <>
      {printers.length > 0 && <AutoRefresh intervalMs={PRINTER_REFRESH_MS} />}
      <PageHeader
        title={`Welcome, ${user.name.split(' ')[0]}`}
        description="Your print library at a glance."
      />

      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Models" value={NUMBER.format(stats.models)} icon={Boxes} href="/models" />
        <Stat label="Files" value={NUMBER.format(stats.files)} icon={Wrench} />
        <Stat
          label={
            /*
             * Null, not zero, when nothing has settled: a print still running is
             * not a failed one, and a 0% badge on a new library reads as broken.
             */
            prints.successRate == null
              ? 'Prints logged'
              : `Prints logged · ${Math.round(prints.successRate * 100)}% success`
          }
          value={NUMBER.format(prints.total)}
          icon={History}
          href="/prints"
        />
        <Stat
          label="Libraries"
          value={NUMBER.format(stats.libraries)}
          icon={HardDrive}
          href={canManage ? '/admin/libraries' : undefined}
        />
      </div>

      <UnratedPrints
        prints={unrated.map((print) => ({
          ...print,
          finishedAt: print.finishedAt?.toISOString() ?? null,
        }))}
      />

      {printers.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Printers</h2>
            <Link href="/printers" className="text-sm text-[var(--color-accent)] hover:underline">
              Printer status
            </Link>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {printers.map((printer) => (
              <Card
                key={printer.id}
                className="transition-shadow hover:shadow-[var(--shadow-card)]"
              >
                <Link href="/printers" className="block space-y-2 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{printer.name}</span>
                    <Badge tone={printer.tone}>{printer.label}</Badge>
                  </div>
                  {printer.filename && (
                    <p
                      className="truncate text-xs text-[var(--color-ink-muted)]"
                      title={printer.filename}
                    >
                      {printer.filename}
                    </p>
                  )}
                  {printer.progress != null && (
                    <LiveProgressBar
                      progress={printer.progress}
                      remainingSec={printer.remainingSec}
                      ageSec={printer.ageSec}
                      ticking={!printer.paused}
                      label={`${printer.name} progress`}
                      compact
                    />
                  )}
                  {printer.doneAt && (
                    <p className="text-xs text-[var(--color-ink-muted)]">
                      Done around <ClockTime value={printer.doneAt} />
                    </p>
                  )}
                </Link>
              </Card>
            ))}
          </div>
        </section>
      )}

      {queued.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Waiting to print</h2>
            <Link href="/queue" className="text-sm text-[var(--color-accent)] hover:underline">
              Print queue
            </Link>
          </div>

          <Card className="overflow-hidden">
            <ul className="divide-y divide-[var(--color-border)]">
              {queued.map((request) => (
                <li key={request.id} className="flex items-center gap-3 px-4 py-2.5">
                  <ClipboardList className="size-4 shrink-0 text-[var(--color-ink-faint)]" />

                  <span className="min-w-0 flex-1 truncate text-sm">
                    {request.modelPublicId ? (
                      <Link href={`/models/${request.modelPublicId}`} className="hover:underline">
                        {request.title}
                      </Link>
                    ) : (
                      request.title
                    )}
                  </span>
                  {/*
                    Outside the truncating span: inside it, a long title ate the
                    whole line and pushed the quantity off the screen, which is
                    the one number that changes what you do about the request.
                  */}
                  {request.quantity > 1 && (
                    <span className="shrink-0 text-sm text-[var(--color-ink-faint)]">
                      × {request.quantity}
                    </span>
                  )}

                  {request.requestedBy && (
                    <span className="hidden shrink-0 text-xs text-[var(--color-ink-muted)] sm:inline">
                      for {request.requestedBy}
                    </span>
                  )}
                  {request.status === 'printing' && <Badge tone="accent">On the printer</Badge>}
                  {request.priority === 'high' && request.status !== 'printing' && (
                    <Badge tone="danger">Urgent</Badge>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {stats.libraries === 0 ? (
        <EmptyState
          icon={<HardDrive />}
          title="No libraries yet"
          description={
            canManage
              ? 'Point PrintBench at a folder of STL and 3MF files and it will index them in place. Your files are never moved or renamed.'
              : 'An admin needs to add a library before anything appears here.'
          }
          action={
            canManage ? (
              <Button asChild>
                <Link href="/admin/libraries/new">Add a library</Link>
              </Button>
            ) : undefined
          }
        />
      ) : models.length === 0 ? (
        <EmptyState
          icon={<Boxes />}
          title="Nothing indexed yet"
          description="The library is there but empty. Run a scan to populate it."
          action={
            canManage ? (
              <Button asChild variant="secondary">
                <Link href="/admin/libraries">Go to libraries</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <section className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Recently added</h2>
            <Link href="/models" className="text-sm text-[var(--color-accent)] hover:underline">
              All models
            </Link>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {models.map((model) => (
              <ModelCard
                key={model.public_id}
                publicId={model.public_id}
                name={model.name}
                path={model.path}
                fileCount={model.file_count}
                totalSize={Number(model.total_size)}
                libraryName={model.library_name}
                isPackage={model.is_package}
                previewExtension={model.preview_extension}
                previewImageFileId={model.preview_image_file_id}
                thumbFileId={model.thumb_file_id}
                thumbKey={model.thumb_key}
                dimensions={formatDimensions(
                  Number(model.bbox_x ?? 0),
                  Number(model.bbox_y ?? 0),
                  Number(model.bbox_z ?? 0),
                )}
              />
            ))}
          </div>
        </section>
      )}

      {latestPrints.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Latest prints</h2>
            <Link href="/prints" className="text-sm text-[var(--color-accent)] hover:underline">
              Print history
            </Link>
          </div>

          <Card className="overflow-hidden">
            <ul className="divide-y divide-[var(--color-border)]">
              {latestPrints.map((print, index) => (
                <li
                  key={`${print.public_id}-${index}`}
                  className="flex items-center gap-3 px-4 py-2.5"
                >
                  <Printer className="size-4 shrink-0 text-[var(--color-ink-faint)]" />
                  <Link
                    href={`/models/${print.public_id}`}
                    className="min-w-0 flex-1 truncate text-sm hover:underline"
                  >
                    {print.model_name}
                  </Link>
                  <span className="hidden shrink-0 text-xs text-[var(--color-ink-muted)] sm:inline">
                    {[print.printer_name, print.material].filter(Boolean).join(' · ')}
                  </span>
                  <span className="shrink-0 text-xs text-[var(--color-ink-faint)]">
                    {new Date(print.started_at ?? print.created_at).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </>
  )
}
