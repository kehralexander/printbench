import Link from 'next/link'
import type { Route } from 'next'
import { eq, sql } from 'drizzle-orm'
import { Printer } from 'lucide-react'
import { getSessionUser } from '@pb/auth'
import {
  can,
  decryptSecret,
  matchLibraryFile,
  readPrinterStatus,
  spoolmanSpoolLink,
  type FilamentSlot,
  type PrinterStatus,
} from '@pb/core'
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

/** The queue request the printer's current job is for, when the worker matched one. */
interface JobRequest {
  title: string
  requestedBy: string | null
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

  const [files, jobRequests] = await Promise.all([
    Promise.all(
      statuses.map((status) => (status.filename ? findPrintedFile(status.filename) : null)),
    ),
    openJobRequests(),
  ])
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
            request={statuses[index]!.busy ? (jobRequests.get(host.id) ?? null) : null}
            doneAt={doneAt[index] ?? null}
          />
        ))}
      </div>
    </>
  )
}

async function findPrintedFile(printerFilename: string): Promise<PrintedFile | null> {
  const file = await matchLibraryFile(getDb(), printerFilename)
  if (!file) return null
  return {
    modelPublicId: file.modelPublicId,
    modelName: file.modelName,
    thumbUrl:
      file.thumbState === 'ok' && file.thumbKey
        ? `/api/files/${file.modelFileId}/thumb?v=${encodeURIComponent(file.thumbKey)}`
        : null,
  }
}

async function openJobRequests(): Promise<Map<string, JobRequest>> {
  const rows = await getDb().execute<{
    host_id: string
    title: string
    requested_by: string | null
  }>(sql`
    SELECT j.host_id, r.title, r.requested_by
    FROM printer_jobs j JOIN print_requests r ON r.id = j.request_id
    WHERE j.finished_at IS NULL`)
  return new Map(
    rows.rows.map((row) => [row.host_id, { title: row.title, requestedBy: row.requested_by }]),
  )
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
  request,
  doneAt,
}: {
  name: string
  status: PrinterStatus
  file: PrintedFile | null
  request: JobRequest | null
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
            {request && (
              <p className="truncate text-xs text-[var(--color-ink-muted)]">
                For{' '}
                <Link href="/queue" className="text-[var(--color-accent)] hover:underline">
                  {request.title}
                </Link>
                {request.requestedBy && ` · ${request.requestedBy}`}
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

      {status.slots && status.slots.length > 0 && <Slots slots={status.slots} />}

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

/** The filament in a multi-material unit, slot by slot, the active one marked. */
function Slots({ slots }: { slots: FilamentSlot[] }) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Loaded filament">
      {slots.map((slot) => {
        const link = slot.spoolmanSpoolId != null ? spoolmanSpoolLink(slot.spoolmanSpoolId) : null
        return (
          <li
            key={slot.index}
            className={
              slot.active
                ? 'flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-accent)] px-2 py-1.5'
                : 'flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-border)] px-2 py-1.5'
            }
          >
            <span
              className="size-4 shrink-0 rounded-full ring-1 ring-inset ring-[var(--color-border)]"
              style={{
                backgroundColor: slot.loaded ? (slot.colorHex ?? 'transparent') : 'transparent',
              }}
            />
            <span className="min-w-0 text-xs">
              <span className="block font-medium">
                Slot {slot.index + 1}
                {slot.active && ' · in use'}
              </span>
              <span className="block truncate text-[var(--color-ink-muted)]">
                {!slot.loaded ? (
                  'Empty'
                ) : link ? (
                  <a
                    href={link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--color-accent)] hover:underline"
                  >
                    {slot.material ?? 'Loaded'} · #{slot.spoolmanSpoolId}
                  </a>
                ) : (
                  (slot.material ?? 'Loaded')
                )}
              </span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}
