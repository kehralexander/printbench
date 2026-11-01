import Link from 'next/link'
import { CheckCircle2 } from 'lucide-react'
import { getSessionUser } from '@pb/auth'
import { can, formatEstimate, unmatchedJobs } from '@pb/core'
import { getDb, schema } from '@pb/db'
import { PageHeader } from '@/components/shell/page-header'
import { NotPermitted } from '@/components/shell/not-permitted'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { JobRow, type JobLine } from './job-row'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Printer jobs not in the library' }

/**
 * Prints the worker saw whose file matched nothing in the library — started
 * from the printer's screen, or sent straight from a slicer. Each can be filed
 * under a model (which writes its history entry after the fact), have its file
 * fetched from the printer into a model's folder, or be waved off.
 */
export default async function UnmatchedJobsPage() {
  const user = await getSessionUser()
  if (!can(user, 'model:view')) return <NotPermitted what="printer jobs" />

  const db = getDb()
  const [jobs, hosts] = await Promise.all([
    unmatchedJobs(db),
    db
      .select({ id: schema.printHosts.id, protocol: schema.printHosts.protocol })
      .from(schema.printHosts),
  ])
  const protocol = new Map(hosts.map((host) => [host.id, host.protocol]))

  const lines: JobLine[] = jobs.map((job) => ({
    id: job.id,
    printerName: job.printerName,
    filename: job.filename,
    status: job.status,
    percent: job.progress != null ? Math.round(job.progress * 100) : null,
    duration: job.printSec ? formatEstimate(job.printSec / 60) : null,
    startedAt: job.startedAt.toISOString(),
    fetchable: ['moonraker', 'kx-bridge', 'octoprint'].includes(protocol.get(job.hostId) ?? ''),
  }))

  return (
    <>
      <PageHeader
        title="Printer jobs not in the library"
        description="Prints whose file PrintBench did not have. Link each to a model to add it to the print history, or fetch the file from the printer into a model."
      />
      <p className="-mt-5 mb-6 text-sm">
        <Link href="/printers" className="text-[var(--color-accent)] hover:underline">
          Back to printer status
        </Link>
      </p>
      {lines.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 />}
          title="Every print is accounted for"
          description="Jobs started from the printer's screen or straight from a slicer show up here when their file is not in the library."
        />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-[var(--color-border)]">
            {lines.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                canLink={can(user, 'print:log')}
                canAdd={can(user, 'file:upload')}
              />
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}
