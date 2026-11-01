import Link from 'next/link'
import type { Route } from 'next'
import { BarChart3 } from 'lucide-react'
import { getSessionUser } from '@pb/auth'
import { can, failureHint, printOutcomeStats, type OutcomeRow, type OutcomeSort } from '@pb/core'
import { getDb } from '@pb/db'
import { Breadcrumbs } from '@/components/shell/breadcrumbs'
import { PageHeader } from '@/components/shell/page-header'
import { NotPermitted } from '@/components/shell/not-permitted'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { SectionHeader } from '@/components/ui/section-header'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { UrlSortControl } from '@/components/ui/sort-control'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { cn } from '@/lib/cn'
import { pickSort, type SortOption } from '@/lib/sort'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Success rates' }

/** One order for all three tables, so they read alike. */
const SORTS: SortOption<OutcomeSort>[] = [
  { value: 'failures', label: 'Most failures' },
  { value: 'rate', label: 'Lowest success rate' },
  { value: 'prints', label: 'Most prints' },
  { value: 'name', label: 'Name' },
]

/**
 * How often prints come out, by model, by file and by material, and where
 * the failed ones usually stopped — the printer's own progress for every
 * print the tracker logged.
 */
export default async function SuccessRatesPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>
}) {
  const user = await getSessionUser()
  if (!can({ id: user?.id ?? '', role: user?.role ?? null }, 'model:view')) {
    return <NotPermitted what="print statistics" />
  }

  const sort = pickSort((await searchParams).sort, SORTS, 'failures')
  const stats = await printOutcomeStats(getDb(), 50, sort)

  return (
    <>
      <Breadcrumbs items={[{ label: 'Print history', href: '/prints' }]} />
      <PageHeader
        title="Success rates"
        description="Finished prints only. Where a failed print stopped comes from the printer, for prints PrintBench followed."
      />

      {stats.byModel.length === 0 ? (
        <EmptyState
          icon={<BarChart3 />}
          title="Nothing to count yet"
          description="Once prints are logged as succeeded or failed, their rates show up here."
        />
      ) : (
        <>
          {/* One sort orders all three tables, so it sits above all of them
              rather than on the first one's heading. */}
          <ListToolbar
            sort={
              <UrlSortControl
                options={SORTS}
                value={sort}
                defaultValue="failures"
                count={stats.byModel.length}
              />
            }
          />
          <div className="space-y-8">
            <OutcomeTable title="By model" rows={stats.byModel} />
            {stats.byFile.length > 0 && <OutcomeTable title="By file" rows={stats.byFile} />}
            <OutcomeTable title="By material" rows={stats.byMaterial} />
          </div>
        </>
      )}
    </>
  )
}

function OutcomeTable({ title, rows }: { title: string; rows: OutcomeRow[] }) {
  return (
    <section>
      <SectionHeader title={title} />
      <Card className="overflow-hidden">
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH className="text-right">Prints</TH>
              <TH className="text-right">Success</TH>
              <TH className="text-right">Failed</TH>
              <TH>Usually fails</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((row) => (
              <TR key={row.key}>
                <TD className="max-w-xs truncate">
                  {row.modelPublicId ? (
                    <Link
                      href={`/models/${row.modelPublicId}` as Route}
                      className="hover:underline"
                    >
                      {row.label}
                    </Link>
                  ) : (
                    row.label
                  )}
                </TD>
                <TD className="text-right">{row.total}</TD>
                <TD
                  className={cn(
                    'text-right',
                    row.successRate != null &&
                      row.successRate < 0.7 &&
                      'font-medium text-[var(--color-danger)]',
                  )}
                >
                  {row.successRate != null ? `${Math.round(row.successRate * 100)}%` : '—'}
                </TD>
                <TD className="text-right">{row.failures}</TD>
                <TD className="text-xs text-[var(--color-ink-muted)]">
                  {row.typicalFailureAt != null ? (
                    <>
                      <span className="font-medium text-[var(--color-ink)]">
                        around {Math.round(row.typicalFailureAt * 100)}%
                      </span>{' '}
                      · {failureHint(row.typicalFailureAt)}
                      {row.failuresWithProgress < row.failures &&
                        ` (${row.failuresWithProgress} of ${row.failures} known)`}
                    </>
                  ) : row.failures > 0 ? (
                    'stopping point not known'
                  ) : (
                    ''
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </section>
  )
}
