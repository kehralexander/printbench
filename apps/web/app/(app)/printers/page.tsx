import Link from 'next/link'
import type { Route } from 'next'
import { eq, sql } from 'drizzle-orm'
import { Printer } from 'lucide-react'
import { getSessionUser } from '@pb/auth'
import { can, decryptSecret, readPrinterStatus, type PrinterStatus } from '@pb/core'
import { formatEstimate } from '@pb/core/requests'
import { getDb, schema } from '@pb/db'
import { PageHeader } from '@/components/shell/page-header'
import { NotPermitted } from '@/components/shell/not-permitted'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { ClockTime } from '@/components/ui/clock-time'
import { EmptyState } from '@/components/ui/empty-state'
import { AutoRefresh } from './auto-refresh'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Printer status' }

const REFRESH_MS = 10_000

/** The library file a printer's job most likely is, found by name. */
interface PrintedFile {
  modelPublicId: string
  modelName: string
  thumbUrl: string | null
}

/**
 * What each configured printer is doing: idle, or busy with which file, how
 * far along, and when it should be done. Read live from the printers on every
 * render; nothing here is stored except when each was last reachable.
 */
export default async function PrintersPage() {
  const user = await getSessionUser()
  if (!can(user, 'model:view')) return <NotPermitted what="printer status" />

  const db = getDb()
  const hosts = await db.select().from(schema.printHosts).orderBy(schema.printHosts.name)

  if (hosts.length === 0) {
    return (
      <>
        <PageHeader title="Printer status" />
        <EmptyState
          icon={<Printer />}
          title="No printers yet"
          description="Add a networked printer — Moonraker (Klipper, KX-Bridge), OctoPrint or PrusaLink — and its status shows up here."
          action={
            can(user, 'printhost:manage') ? (
              <Link
                href="/admin/printers"
                className="text-sm text-[var(--color-accent)] hover:underline"
              >
                Add a printer
              </Link>
            ) : undefined
          }
        />
      </>
    )
  }

  const statuses = await Promise.all(
    hosts.map((host) =>
      readPrinterStatus({
        id: host.id,
        name: host.name,
        protocol: host.protocol,
        endpoint: host.endpoint,
        apiKey: decryptSecret(host.credentials),
      }),
    ),
  )

  const reachable = hosts.filter((_, index) => statuses[index]!.state !== 'offline')
  if (reachable.length > 0) {
    await Promise.all(
      reachable.map((host) =>
        db
          .update(schema.printHosts)
          .set({ lastSeenOk: new Date() })
          .where(eq(schema.printHosts.id, host.id)),
      ),
    ).catch(() => undefined)
  }

  const files = await Promise.all(
    statuses.map((status) => (status.filename ? findPrintedFile(status.filename) : null)),
  )
  const doneAt = statuses.map(doneAround)

  return (
    <>
      <AutoRefresh intervalMs={REFRESH_MS} />
      <PageHeader
        title="Printer status"
        description="What each printer is doing right now. Updates every few seconds."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {hosts.map((host, index) => (
          <PrinterCard
            key={host.id}
            name={host.name}
            status={statuses[index]!}
            file={files[index] ?? null}
            doneAt={doneAt[index] ?? null}
          />
        ))}
      </div>
    </>
  )
}

/**
 * Printers report the file by the name it was uploaded under, often with a
 * directory in front. A sliced file in the library with that name is very
 * likely the one — the newest wins if several share it.
 */
async function findPrintedFile(printerFilename: string): Promise<PrintedFile | null> {
  const name = printerFilename.split('/').pop()?.trim().toLowerCase()
  if (!name) return null
  const rows = await getDb().execute<{
    file_id: string
    thumb_state: string | null
    thumb_key: string | null
    public_id: string
    name: string
  }>(sql`
    SELECT f.id AS file_id, f.thumb_state, f.thumb_key, m.public_id, m.name
    FROM model_files f
    JOIN models m ON m.id = f.model_id
    WHERE f.missing_at IS NULL AND m.missing_at IS NULL
      AND f.category = 'slicer'
      AND lower(regexp_replace(f.filename, '^.*/', '')) = ${name}
    ORDER BY f.updated_at DESC
    LIMIT 1
  `)
  const row = rows.rows[0]
  if (!row) return null
  return {
    modelPublicId: row.public_id,
    modelName: row.name,
    thumbUrl:
      row.thumb_state === 'ok' && row.thumb_key
        ? `/api/files/${row.file_id}/thumb?v=${encodeURIComponent(row.thumb_key)}`
        : null,
  }
}

/** A paused job has no finish time; it ends whenever someone resumes it. */
function doneAround(status: PrinterStatus): string | null {
  if (status.state !== 'printing' || status.remainingSec == null) return null
  return new Date(Date.now() + status.remainingSec * 1000).toISOString()
}

const STATE_LABEL: Record<PrinterStatus['state'], string> = {
  idle: 'Idle',
  printing: 'Printing',
  paused: 'Paused',
  complete: 'Finished',
  cancelled: 'Cancelled',
  error: 'Error',
  offline: 'Offline',
}

function PrinterCard({
  name,
  status,
  file,
  doneAt,
}: {
  name: string
  status: PrinterStatus
  file: PrintedFile | null
  /** When the job should finish, if the printer is printing and says how long. */
  doneAt: string | null
}) {
  const percent = status.progress != null ? Math.round(status.progress * 1000) / 10 : null
  const tone =
    status.state === 'printing'
      ? 'accent'
      : status.state === 'error' || status.state === 'offline'
        ? 'danger'
        : 'neutral'
  // Finished and cancelled still name the last job; idle has nothing to show.
  const showJob = status.filename && status.state !== 'idle' && status.state !== 'offline'

  return (
    <Card className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="truncate text-base font-semibold">{name}</h2>
        <Badge tone={tone}>
          {status.busy ? `Busy · ${STATE_LABEL[status.state]}` : STATE_LABEL[status.state]}
        </Badge>
      </div>

      {status.message && (
        <p
          className={
            status.state === 'error' || status.state === 'offline'
              ? 'text-sm text-[var(--color-danger)]'
              : 'text-sm text-[var(--color-ink-muted)]'
          }
        >
          {status.message}
        </p>
      )}

      {showJob && (
        <div className="flex gap-4">
          {file?.thumbUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={file.thumbUrl}
              alt=""
              className="size-20 shrink-0 rounded-[var(--radius-control)] bg-[var(--color-surface-2)] object-contain"
            />
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <p className="truncate text-sm font-medium" title={status.filename}>
              {status.filename!.split('/').pop()}
            </p>
            {file && (
              <p className="truncate text-xs text-[var(--color-ink-muted)]">
                <Link
                  href={`/models/${file.modelPublicId}` as Route}
                  className="text-[var(--color-accent)] hover:underline"
                >
                  {file.modelName}
                </Link>
              </p>
            )}
            {status.layer != null && status.totalLayers != null && status.totalLayers > 0 && (
              <p className="text-xs text-[var(--color-ink-muted)]">
                Layer {status.layer} of {status.totalLayers}
              </p>
            )}
          </div>
        </div>
      )}

      {status.busy && (
        <div className="space-y-2">
          {percent != null && (
            <div className="flex items-center gap-3">
              <div
                role="progressbar"
                aria-label={`${name} progress`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(percent)}
                className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]"
              >
                <div
                  className="h-full rounded-full bg-[var(--color-accent)] transition-[width]"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <span className="w-14 text-right text-sm font-semibold tabular-nums">
                {percent.toFixed(percent < 10 ? 1 : 0)}%
              </span>
            </div>
          )}
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <Fact label="Elapsed">
              {status.elapsedSec != null ? formatEstimate(status.elapsedSec / 60) : '—'}
            </Fact>
            <Fact
              label="Remaining"
              title={
                status.remainingSource === 'extrapolated'
                  ? 'Extrapolated from progress so far'
                  : undefined
              }
            >
              {status.remainingSec != null
                ? `${status.remainingSource === 'extrapolated' ? '~' : ''}${formatEstimate(status.remainingSec / 60)}`
                : '—'}
            </Fact>
            <Fact label="Done around">{doneAt ? <ClockTime value={doneAt} /> : '—'}</Fact>
          </dl>
        </div>
      )}

      {(status.nozzle || status.bed) && (
        <p className="text-xs text-[var(--color-ink-muted)]">
          {status.nozzle && <>Nozzle {temperature(status.nozzle)}</>}
          {status.nozzle && status.bed && ' · '}
          {status.bed && <>Bed {temperature(status.bed)}</>}
        </p>
      )}
    </Card>
  )
}

function Fact({
  label,
  title,
  children,
}: {
  label: string
  title?: string
  children: React.ReactNode
}) {
  return (
    <div title={title}>
      <dt className="text-xs text-[var(--color-ink-muted)]">{label}</dt>
      <dd className="font-medium tabular-nums">{children}</dd>
    </div>
  )
}

function temperature({ actual, target }: { actual: number; target: number }): string {
  return target > 0
    ? `${Math.round(actual)} / ${Math.round(target)} °C`
    : `${Math.round(actual)} °C`
}
