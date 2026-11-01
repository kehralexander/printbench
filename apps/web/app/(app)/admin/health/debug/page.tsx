import type { Route } from 'next'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { debugReportToMarkdown, formatBytes, type DebugReport } from '@pb/core'
import { PROBLEM_META } from '@pb/core/health'
import { diagnosticsUser } from '@/lib/diagnostics'
import { buildDebugReport } from '@/lib/debug-report'
import { cn } from '@/lib/cn'
import { PageHeader } from '@/components/shell/page-header'
import { NotPermitted } from '@/components/shell/not-permitted'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Callout } from '@/components/ui/callout'
import { LocalTime } from '@/components/ui/local-time'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { StatTile } from '@/components/ui/stat-tile'
import { ShareReport } from './share-report'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Debug info' }

export default async function DebugPage() {
  if (!(await diagnosticsUser())) return <NotPermitted what="debug information" />

  const report = await buildDebugReport()
  const web = report.processes.find((process) => process.source === 'web')
  const worker = report.processes.find((process) => process.source === 'worker')
  const warnings = findWarnings(report)

  return (
    <>
      <PageHeader
        title="Debug info"
        description="A snapshot of how this instance is set up and running. Attach it to a bug report so we can help."
      />

      {warnings.length > 0 && (
        <div className="mb-6 space-y-2">
          {warnings.map((warning) => (
            <Callout key={warning} tone="danger" icon={<AlertTriangle />}>
              {warning}
            </Callout>
          ))}
        </div>
      )}

      {/*
        Status at a glance only. The versions, memory and database details are
        in the sections below; repeating them up here just made two places to
        read the same number.
      */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          value={report.app.version}
          label="Version"
          hint={report.app.commit?.slice(0, 12)}
        />
        <StatTile
          value={web?.alive ? 'Running' : 'Unknown'}
          label="Web"
          hint={web ? undefined : 'No heartbeat yet'}
        />
        <StatTile
          value={worker ? (worker.alive ? 'Running' : 'Not responding') : 'Never seen'}
          label="Worker"
          hint={worker ? undefined : 'No heartbeat yet'}
          tone={worker?.alive ? 'neutral' : 'danger'}
        />
        <StatTile
          value={report.database ? 'Connected' : 'Unavailable'}
          label="Database"
          tone={report.database ? 'neutral' : 'danger'}
        />
      </div>

      <ShareReport
        markdown={debugReportToMarkdown(report)}
        markdownWithoutLogs={debugReportToMarkdown(report, { includeLogs: false })}
        json={JSON.stringify(report, null, 2)}
        logLines={report.recentErrors.length}
      />

      <div className="mt-6 grid items-start gap-4 lg:grid-cols-2">
        <Section title="Processes">
          {report.processes.length === 0 ? (
            <p className="text-sm text-[var(--color-ink-muted)]">No heartbeats recorded yet.</p>
          ) : (
            <dl className="space-y-3 text-sm">
              {report.processes.map((process) => (
                <div key={process.source}>
                  <dt className="font-medium capitalize">{process.source}</dt>
                  <dd className="text-[var(--color-ink-muted)]">
                    v{process.version ?? '?'} · Node {process.node ?? '?'} · {process.platform}/
                    {process.arch} · up since <LocalTime value={process.startedAt} /> · last seen{' '}
                    <LocalTime value={process.seenAt} seconds />
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </Section>

        <Section title="Host">
          <Pairs
            rows={{
              Platform: `${report.host.platform}/${report.host.arch}${report.host.inContainer ? ' (Docker)' : ''}`,
              Kernel: report.host.osRelease,
              CPUs: report.host.cpus,
              Memory: `${report.host.totalMemMb.toLocaleString('en-GB')} MB, ${report.host.freeMemMb.toLocaleString('en-GB')} MB free`,
              'Time zone': report.host.timezone,
              ...(report.dataDir
                ? {
                    'Data volume': `${formatBytes(report.dataDir.freeBytes)} free of ${formatBytes(report.dataDir.totalBytes)}`,
                  }
                : {}),
            }}
          />
        </Section>

        <Section title="Database">
          {report.database ? (
            <Pairs
              rows={{
                PostgreSQL: report.database.version,
                Size: formatBytes(report.database.sizeBytes),
                'Migrations applied': report.database.migrationsApplied,
                Connections: report.database.connections,
                Extensions: report.database.extensions.join(', ') || 'none',
              }}
            />
          ) : (
            <p className="text-sm text-[var(--color-danger)]">
              {report.failures.database ?? 'Unavailable.'}
            </p>
          )}
        </Section>

        <Section title="Configuration">
          <Pairs rows={report.config} mono />
        </Section>

        <Section title="Contents">
          <Pairs
            rows={{
              Models: report.counts.models ?? 0,
              Files: `${(report.counts.files ?? 0).toLocaleString('en-GB')} (${formatBytes(report.counts.fileBytes ?? 0)})`,
              Creators: report.counts.creators ?? 0,
              Tags: report.counts.tags ?? 0,
              Prints: report.counts.prints ?? 0,
              Users: summarise(report.users),
              Thumbnails: summarise(report.derived.thumbnails),
              'Open health problems': summarise(report.problems),
            }}
          />
        </Section>

        <Section title="Job queues" flush={Boolean(report.queues)}>
          {report.queues ? (
            <Table>
              <THead>
                <TR>
                  <TH>Queue</TH>
                  <TH className="text-right">Queued</TH>
                  <TH className="text-right">Active</TH>
                  <TH className="text-right">Failed</TH>
                </TR>
              </THead>
              <TBody>
                {report.queues.map((queue) => (
                  <TR key={queue.name}>
                    <TD className="py-2 font-mono text-xs">{queue.name}</TD>
                    <TD className="py-2 text-right">{queue.queued}</TD>
                    <TD className="py-2 text-right">{queue.active}</TD>
                    <TD
                      className={cn(
                        'py-2 text-right',
                        queue.failed > 0 && 'text-[var(--color-danger)]',
                      )}
                    >
                      {queue.failed}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="text-sm text-[var(--color-danger)]">
              {report.failures.queues ?? 'Unavailable.'}
            </p>
          )}
        </Section>
      </div>

      <Section
        title="Libraries"
        className="mt-4"
        flush={report.libraries.length > 0}
        footer="Libraries are numbered rather than named: names and paths are left out of the report."
      >
        {report.libraries.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-muted)]">No libraries yet.</p>
        ) : (
          <Table className="min-w-[36rem]">
            <THead>
              <TR>
                <TH>#</TH>
                <TH>Type</TH>
                <TH>Grouping</TH>
                <TH className="text-right">Models</TH>
                <TH className="text-right">Missing</TH>
                <TH className="text-right">Files</TH>
                <TH>Last scan</TH>
              </TR>
            </THead>
            <TBody>
              {report.libraries.map((library, index) => (
                <TR key={index}>
                  <TD className="py-2">{index + 1}</TD>
                  <TD className="py-2">
                    {library.kind} · {library.backend}
                  </TD>
                  <TD className="py-2">{library.grouping}</TD>
                  <TD className="py-2 text-right">{library.models.toLocaleString('en-GB')}</TD>
                  <TD className="py-2 text-right">
                    {library.missingModels.toLocaleString('en-GB')}
                  </TD>
                  <TD className="py-2 text-right">{library.files.toLocaleString('en-GB')}</TD>
                  <TD className="py-2">
                    {library.lastScan
                      ? `${library.lastScan.status}${library.lastScan.abortReason ? ` (${library.lastScan.abortReason})` : ''}`
                      : 'never'}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>

      {report.recentErrors.length > 0 && (
        <p className="mt-4 text-sm text-[var(--color-ink-muted)]">
          {report.recentErrors.length} recent warning{report.recentErrors.length === 1 ? '' : 's'}{' '}
          and errors are in the log.{' '}
          <Link
            href={'/admin/health/logs?level=warn' as Route}
            className="font-medium text-[var(--color-accent)] hover:underline"
          >
            Open the logs
          </Link>
        </p>
      )}
    </>
  )
}

/** The things worth saying out loud before anyone reads the tables. */
function findWarnings(report: DebugReport): string[] {
  const warnings: string[] = []
  const web = report.processes.find((process) => process.source === 'web')
  const worker = report.processes.find((process) => process.source === 'worker')

  if (!worker) {
    warnings.push(
      'The worker has never reported in. Scans, thumbnails and uploads will not run until its container is started.',
    )
  } else if (!worker.alive) {
    warnings.push(
      'The worker has stopped reporting in. Scans, thumbnails and uploads will not run until it is back.',
    )
  } else if (web?.version && worker.version && web.version !== worker.version) {
    warnings.push(
      `The web app is on ${web.version} but the worker is on ${worker.version}. Update both containers to the same version.`,
    )
  }

  const failed = Object.keys(report.failures)
  if (failed.length > 0) warnings.push(`Could not collect: ${failed.join(', ')}.`)
  return warnings
}

function summarise(record: Record<string, number>): string {
  const entries = Object.entries(record).filter(([, n]) => n > 0)
  return entries.length === 0
    ? 'none'
    : entries
        .map(([key, n]) => {
          // Problem kinds read as the health page words them ("no licence",
          // "no preview"); anything else falls back to its key.
          const label =
            PROBLEM_META[key as keyof typeof PROBLEM_META]?.label ?? key.replace(/_/g, ' ')
          return `${n.toLocaleString('en-GB')} ${label.toLowerCase()}`
        })
        .join(', ')
}

/**
 * One card of the report. `flush` lets a table run edge to edge under the
 * title rather than sitting indented inside the card's padding.
 */
function Section({
  title,
  className,
  flush = false,
  footer,
  children,
}: {
  title: string
  className?: string
  flush?: boolean
  footer?: string
  children: React.ReactNode
}) {
  return (
    <Card className={cn(flush && 'overflow-hidden', className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      {flush ? (
        <div className="border-t border-[var(--color-border)]">{children}</div>
      ) : (
        <CardContent>{children}</CardContent>
      )}
      {footer && (
        <p
          className={cn(
            'px-5 pb-4 text-xs text-[var(--color-ink-faint)]',
            flush && 'border-t border-[var(--color-border)] pt-3',
          )}
        >
          {footer}
        </p>
      )}
    </Card>
  )
}

function Pairs({
  rows,
  mono = false,
}: {
  rows: Record<string, string | number | boolean>
  mono?: boolean
}) {
  return (
    // One column on a phone: a long value gets the full width, not a sliver.
    <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
      {Object.entries(rows).map(([key, value]) => (
        <div key={key} className="contents">
          <dt
            className={cn('text-[var(--color-ink-muted)]', mono && 'font-mono text-xs leading-5')}
          >
            {key}
          </dt>
          <dd className={cn('min-w-0 break-words', mono && 'font-mono text-xs leading-5')}>
            {typeof value === 'number' ? value.toLocaleString('en-GB') : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  )
}
