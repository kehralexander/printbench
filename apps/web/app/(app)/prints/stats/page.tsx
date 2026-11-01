import Link from 'next/link'
import type { Route } from 'next'
import { BarChart3 } from 'lucide-react'
import { getSessionUser } from '@pb/auth'
import { can, failureHint, printOutcomeStats, type OutcomeRow } from '@pb/core'
import { getDb } from '@pb/db'
import { PageHeader } from '@/components/shell/page-header'
import { NotPermitted } from '@/components/shell/not-permitted'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Success rates' }

/**
 * How often prints come out, by model, by file and by material, and where
 * the failed ones usually stopped — the printer's own progress for every
 * print the tracker logged.
 */
export default async function SuccessRatesPage() {
  const user = await getSessionUser()
  if (!can({ id: user?.id ?? '', role: user?.role ?? null }, 'model:view')) {
    return <NotPermitted what="print statistics" />
  }

  const stats = await printOutcomeStats(getDb())

  return (
    <>
      <PageHeader
        title="Success rates"
        description="Finished prints only. Where a failed print stopped comes from the printer, for prints PrintBench followed."
      />
      <p className="-mt-5 mb-6 text-sm">
        <Link href="/prints" className="text-[var(--color-accent)] hover:underline">
          Back to the print history
        </Link>
      </p>

      {stats.byModel.length === 0 ? (
        <EmptyState
          icon={<BarChart3 />}
          title="Nothing to count yet"
          description="Once prints are logged as succeeded or failed, their rates show up here."
        />
      ) : (
        <div className="space-y-8">
          <OutcomeTable title="By model" rows={stats.byModel} />
          {stats.byFile.length > 0 && <OutcomeTable title="By file" rows={stats.byFile} />}
          <OutcomeTable title="By material" rows={stats.byMaterial} />
        </div>
      )}
    </>
  )
}

function OutcomeTable({ title, rows }: { title: string; rows: OutcomeRow[] }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-[var(--color-ink-muted)]">
            <tr className="border-b border-[var(--color-border)]">
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-3 py-2 text-right font-medium">Prints</th>
              <th className="px-3 py-2 text-right font-medium">Success</th>
              <th className="px-3 py-2 text-right font-medium">Failed</th>
              <th className="px-4 py-2 font-medium">Usually fails</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="max-w-xs truncate px-4 py-2">
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
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{row.total}</td>
                <td
                  className={
                    row.successRate != null && row.successRate < 0.7
                      ? 'px-3 py-2 text-right font-medium tabular-nums text-[var(--color-danger)]'
                      : 'px-3 py-2 text-right tabular-nums'
                  }
                >
                  {row.successRate != null ? `${Math.round(row.successRate * 100)}%` : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{row.failures}</td>
                <td className="px-4 py-2 text-xs text-[var(--color-ink-muted)]">
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </section>
  )
}
