import { CheckCircle2 } from 'lucide-react'
import { getSessionUser } from '@pb/auth'
import { can, formatEstimate, unmatchedJobs, type UnmatchedJobSort } from '@pb/core'
import { getDb, schema } from '@pb/db'
import { Breadcrumbs } from '@/components/shell/breadcrumbs'
import { PageHeader } from '@/components/shell/page-header'
import { NotPermitted } from '@/components/shell/not-permitted'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { UrlSortControl } from '@/components/ui/sort-control'
import { pickSort, type SortOption } from '@/lib/sort'
import { JobRow, type JobLine } from './job-row'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Printer jobs not in the library' }

const SORTS: SortOption<UnmatchedJobSort>[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'printer', label: 'Printer' },
  { value: 'filename', label: 'File name' },
]

/**
 * Prints the worker saw whose file matched nothing in the library — started
 * from the printer's screen, or sent straight from a slicer. Each can be filed
 * under a model (which writes its history entry after the fact), have its file
 * fetched from the printer into a model's folder, or be waved off.
 */
export default async function UnmatchedJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>
}) {
  const user = await getSessionUser()
  if (!can(user, 'model:view')) return <NotPermitted what="printer jobs" />
  const sort = pickSort((await searchParams).sort, SORTS, 'newest')

  const db = getDb()
  const [jobs, hosts] = await Promise.all([
    unmatchedJobs(db, 100, sort),
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
      <Breadcrumbs items={[{ label: 'Printer status', href: '/printers' }]} />
      <PageHeader
        title="Printer jobs not in the library"
        description="Prints whose file PrintBench did not have. Link each to a model to add it to the print history, or fetch the file from the printer into a model."
      />
      {lines.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 />}
          title="Every print is accounted for"
          description="Jobs started from the printer's screen or straight from a slicer show up here when their file is not in the library."
        />
      ) : (
        <>
          <ListToolbar
            sort={
              <UrlSortControl
                options={SORTS}
                value={sort}
                defaultValue="newest"
                count={lines.length}
              />
            }
          />
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
        </>
      )}
    </>
  )
}
