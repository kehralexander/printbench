'use client'
import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Filament, Spool, spoolHistory, spoolPrints } from '@pb/core'
import { remainingFromMeasurement } from '@pb/core/filaments'
import { Archive, ArchiveRestore, Copy, History, MoreHorizontal, Pencil } from 'lucide-react'
import { PageHeader } from '@/components/shell/page-header'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { LocalTime } from '@/components/ui/local-time'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { SortControl } from '@/components/ui/sort-control'
import { compareAsc, compareDesc, type SortOption } from '@/lib/sort'
import { PRINT_OUTCOME, type PrintOutcome } from '@/lib/print-outcome'
import { SectionHeader } from '@/components/ui/section-header'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Field } from '@/components/ui/field'
import { StockIndicator } from './library'
import { EditFilamentForm, SpoolForm } from './spool-form'
import { correctSpool, setFilamentArchived, setSpoolArchived } from './actions'
type StockHistory = Awaited<ReturnType<typeof spoolHistory>>
type SpoolPrints = Awaited<ReturnType<typeof spoolPrints>>
export function SpoolDetails({
  title,
  description,
  spool,
  filaments,
  history,
  prints,
  canManage,
}: {
  /** The page header lives here so its actions can open this page's forms. */
  title: string
  description: string
  spool: Spool
  filaments: Filament[]
  history: StockHistory
  prints: SpoolPrints
  canManage: boolean
}) {
  const router = useRouter()
  const [mode, setMode] = useState<'edit' | 'duplicate' | 'filament' | null>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [weighing, setWeighing] = useState(false)
  const [whole, setWhole] = useState('')
  const [empty, setEmpty] = useState(spool.emptyWeightG?.toString() ?? '')
  const [remaining, setRemaining] = useState('')
  let measured: number | null = null
  try {
    if (whole !== '' && empty !== '')
      measured = remainingFromMeasurement(Number(whole), Number(empty))
  } catch {
    /* Shown as an invalid measurement below. */
  }
  function run(action: () => ReturnType<typeof setSpoolArchived>) {
    setError(null)
    startTransition(async () => {
      const result = await action()
      if (!result.ok) setError(result.error)
      else router.refresh()
    })
  }
  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={
          canManage && (
            <>
              <Button variant="secondary" onClick={() => setMode('edit')}>
                <Pencil />
                Edit spool
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" aria-label="More actions">
                    <MoreHorizontal />
                    <span className="hidden sm:inline">More</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    disabled={spool.filament.archived}
                    onSelect={() => setMode('duplicate')}
                  >
                    <Copy />
                    Duplicate spool
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setMode('filament')}>
                    <Pencil />
                    Edit filament details
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={pending || spool.filament.archived}
                    onSelect={() => run(() => setSpoolArchived(spool.id, !spool.spoolArchived))}
                  >
                    {spool.spoolArchived ? <ArchiveRestore /> : <Archive />}
                    {spool.spoolArchived ? 'Restore spool' : 'Archive spool'}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={pending}
                    onSelect={() =>
                      run(() => setFilamentArchived(spool.filamentId, !spool.filament.archived))
                    }
                  >
                    {spool.filament.archived ? <ArchiveRestore /> : <Archive />}
                    {spool.filament.archived
                      ? 'Restore filament'
                      : 'Archive filament and all its spools'}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )
        }
      />
      <div className="space-y-5">
        <Card className="p-5">
          <StockIndicator spool={spool} />
          <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-[var(--color-ink-muted)]">Location</dt>
              <dd>{spool.location || 'Not set'}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-ink-muted)]">Purchase cost</dt>
              <dd>{spool.purchaseCost?.toFixed(2) ?? 'Unknown'}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-ink-muted)]">Diameter</dt>
              <dd>{spool.filament.diameterMm} mm</dd>
            </div>
            <div>
              <dt className="text-[var(--color-ink-muted)]">Nozzle / bed</dt>
              <dd>
                {spool.filament.nozzleTempC ?? '—'} / {spool.filament.bedTempC ?? '—'} °C
              </dd>
            </div>
            <div>
              <dt className="text-[var(--color-ink-muted)]">Empty spool</dt>
              <dd>{spool.emptyWeightG == null ? 'Unknown' : `${spool.emptyWeightG} g`}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-ink-muted)]">Low stock at</dt>
              <dd>{spool.lowStockG} g</dd>
            </div>
          </dl>
          {[spool.filament.notes, spool.notes].filter(Boolean).map((note, i) => (
            <p key={i} className="mt-3 whitespace-pre-wrap text-sm">
              {note}
            </p>
          ))}
        </Card>
        {mode === 'filament' && (
          <EditFilamentForm filament={spool.filament} onCancel={() => setMode(null)} />
        )}
        {(mode === 'edit' || mode === 'duplicate') && (
          <SpoolForm
            key={mode}
            initial={spool}
            duplicate={mode === 'duplicate'}
            filaments={filaments}
            onCancel={() => setMode(null)}
          />
        )}
        {canManage && (
          <Card>
            <CardHeader>
              <CardTitle>Update remaining weight</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  const data = new FormData(e.currentTarget)
                  run(() =>
                    correctSpool(spool.id, {
                      ...(weighing
                        ? { wholeG: Number(whole), emptyG: Number(empty) }
                        : { remainingG: Number(remaining) }),
                      reason: String(data.get('reason') ?? ''),
                    }),
                  )
                }}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Method" htmlFor="weight-method">
                    <Select
                      id="weight-method"
                      value={weighing ? 'weigh' : 'direct'}
                      onChange={(e) => setWeighing(e.target.value === 'weigh')}
                    >
                      <option value="direct">Enter filament remaining</option>
                      <option value="weigh">Weigh the whole spool</option>
                    </Select>
                  </Field>
                  {weighing ? (
                    <>
                      <Field label="Whole spool weight (g)" htmlFor="whole-weight">
                        <Input
                          id="whole-weight"
                          type="number"
                          min="0"
                          step="0.01"
                          required
                          value={whole}
                          onChange={(e) => setWhole(e.target.value)}
                        />
                      </Field>
                      <Field label="Empty spool weight (g)" htmlFor="empty-weight">
                        <Input
                          id="empty-weight"
                          type="number"
                          min="0"
                          step="0.01"
                          required
                          value={empty}
                          onChange={(e) => setEmpty(e.target.value)}
                        />
                      </Field>
                      <p className="self-center text-sm">
                        {measured == null
                          ? 'Enter weights with the whole spool heavier than its empty weight.'
                          : `${measured} g filament remaining`}
                      </p>
                    </>
                  ) : (
                    <Field label="Filament remaining (g)" htmlFor="remaining-weight">
                      <Input
                        id="remaining-weight"
                        type="number"
                        min="0"
                        step="0.01"
                        required
                        value={remaining}
                        onChange={(e) => setRemaining(e.target.value)}
                      />
                    </Field>
                  )}
                  <Field label="Reason" htmlFor="weight-reason">
                    <Input
                      id="weight-reason"
                      name="reason"
                      required
                      placeholder="Weighed after printing outside PrintBench"
                    />
                  </Field>
                </div>
                <Button disabled={pending || (weighing && measured == null)}>
                  Save weight correction
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
        {error && (
          <p role="alert" className="text-sm text-[var(--color-danger)]">
            {error}
          </p>
        )}
        <SpoolActivity history={history} prints={prints} />
      </div>
    </>
  )
}

type ActivitySort = 'newest' | 'oldest' | 'largest'

const ACTIVITY_SORTS: SortOption<ActivitySort>[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'largest', label: 'Largest change' },
]

interface ActivityEntry {
  key: string
  at: string
  reason: string
  modelName: string | null
  modelPublicId: string | null
  actor: string | null
  /** Signed: negative is filament used. */
  grams: number
  status: string | null
  /** Not yet taken off the balance: a print still running. */
  pending: boolean
}

/**
 * Everything that moved this spool's balance, prints and corrections alike.
 *
 * One list rather than "prints" and "stock history" side by side: every
 * finished print is also a stock change, so two lists showed the same rows
 * twice. A print still running has no stock change yet and joins the list as
 * an estimate.
 */
function SpoolActivity({ history, prints }: { history: StockHistory; prints: SpoolPrints }) {
  const [sort, setSort] = useState<ActivitySort>('newest')
  const status = new Map(prints.map((print) => [print.id, print.status]))
  const charged = new Set(history.map((change) => change.print_run_id).filter(Boolean))

  const entries: ActivityEntry[] = [
    ...history.map((change) => ({
      key: change.id,
      at: change.created_at,
      reason: change.reason,
      modelName: change.model_name,
      modelPublicId: change.model_public_id,
      actor: change.actor_name,
      grams: change.amount_g,
      status: change.print_run_id ? (status.get(change.print_run_id) ?? null) : null,
      pending: false,
    })),
    ...prints
      .filter((print) => !charged.has(print.id))
      .map((print) => ({
        key: print.id,
        at: print.created_at,
        reason: print.status === 'in_progress' ? 'Still printing (estimate)' : 'Print',
        modelName: print.model_name,
        modelPublicId: print.model_public_id,
        actor: null,
        grams: -print.grams,
        status: print.status,
        pending: true,
      })),
  ].sort((a, b) =>
    sort === 'oldest'
      ? compareAsc(a.at, b.at)
      : sort === 'largest'
        ? Math.abs(b.grams) - Math.abs(a.grams) || compareDesc(a.at, b.at)
        : compareDesc(a.at, b.at),
  )

  return (
    <section>
      <SectionHeader title="Stock history" />
      {entries.length === 0 ? (
        <EmptyState
          icon={<History />}
          title="Nothing yet"
          description="Prints and weight corrections for this spool appear here."
          className="py-10"
        />
      ) : (
        <>
          <ListToolbar
            sort={
              <SortControl
                options={ACTIVITY_SORTS}
                value={sort}
                onChange={setSort}
                count={entries.length}
              />
            }
          />
          <Card className="overflow-hidden">
            <ol className="divide-y divide-[var(--color-border)]">
              {entries.map((entry) => {
                const outcome =
                  entry.status && entry.status in PRINT_OUTCOME
                    ? PRINT_OUTCOME[entry.status as PrintOutcome]
                    : null
                return (
                  <li
                    key={entry.key}
                    className="flex flex-wrap items-start justify-between gap-3 p-4 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        {entry.reason}
                        {/* Icon and word, as the print lists show an outcome. */}
                        {outcome && (
                          <span className="inline-flex items-center gap-1 text-xs font-normal text-[var(--color-ink-faint)]">
                            <outcome.icon aria-hidden className={`size-3.5 ${outcome.textClass}`} />
                            {outcome.label}
                          </span>
                        )}
                      </p>
                      {entry.modelPublicId && (
                        <Link
                          href={`/models/${entry.modelPublicId}`}
                          className="text-[var(--color-accent)] hover:underline"
                        >
                          {entry.modelName}
                        </Link>
                      )}
                      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                        <LocalTime value={entry.at} />
                        {entry.actor ? ` · ${entry.actor}` : ''}
                      </p>
                    </div>
                    <span
                      className="font-medium tabular-nums"
                      title={entry.pending ? 'Not yet taken off the balance' : undefined}
                    >
                      {entry.pending && '~'}
                      {entry.grams > 0 ? '+' : ''}
                      {entry.grams} g
                    </span>
                  </li>
                )
              })}
            </ol>
          </Card>
        </>
      )}
    </section>
  )
}
