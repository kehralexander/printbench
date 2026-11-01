'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, History, MoreHorizontal, RefreshCw, ScanSearch, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { triggerScan } from './actions'
import { DeleteLibraryDialog } from './delete-library-dialog'

/**
 * A library card's actions: the everyday scan as a button, and the rarer ones
 * — a deep scan, restoring from sidecars, removing the library — in a "More"
 * menu, the same split the model and spool pages use.
 */
export function LibraryActions({
  libraryId,
  name,
  modelCount,
  writesSidecars,
  needsConfirmation,
}: {
  libraryId: string
  name: string
  modelCount: number
  writesSidecars: boolean
  needsConfirmation?: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [confirmingRestore, setConfirmingRestore] = useState(false)
  const [removing, setRemoving] = useState(false)

  const removeDialog = (
    <DeleteLibraryDialog
      libraryId={libraryId}
      name={name}
      modelCount={modelCount}
      writesSidecars={writesSidecars}
      open={removing}
      onOpenChange={setRemoving}
    />
  )

  function moreMenu(scans: boolean) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={`More actions for ${name}`}>
            <MoreHorizontal />
            <span className="hidden sm:inline">More</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {scans && (
            <>
              <DropdownMenuItem disabled={pending} onSelect={() => run({ mode: 'deep' })}>
                <ScanSearch />
                Deep scan
              </DropdownMenuItem>
              <DropdownMenuItem disabled={pending} onSelect={() => setConfirmingRestore(true)}>
                <History />
                Restore from sidecars…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem tone="danger" onSelect={() => setRemoving(true)}>
            <Trash2 />
            Remove library…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  function run(
    options: {
      mode?: 'fast' | 'deep'
      force?: boolean
      restoreSidecars?: boolean
    } = {},
  ) {
    setMessage(null)
    setConfirming(false)
    setConfirmingRestore(false)
    startTransition(async () => {
      const result = await triggerScan(libraryId, options)
      setMessage(result.ok ? 'Scan queued' : result.error)
      // Nothing changed on failure, and a refresh can replace the page (a
      // revoked role, say) before the error has been read.
      if (result.ok) router.refresh()
    })
  }

  /*
   * A previous scan refused to proceed because too much would have disappeared.
   * Re-running normally would just abort again, so the only way forward is an
   * explicit confirmation — deliberately a two-step, destructive-looking action.
   */
  if (needsConfirmation) {
    return (
      <div className="flex flex-col items-end gap-2">
        {confirming ? (
          <div className="flex flex-col items-end gap-2 rounded-[var(--radius-control)] border border-[var(--color-danger)] bg-[var(--color-danger-soft)] p-3">
            <p className="max-w-xs text-right text-xs text-[var(--color-ink)]">
              Only confirm if you really did delete those models. If a drive or network share is
              unmounted, fix that first. Confirming will mark everything on it as missing.
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={pending}
                onClick={() => run({ force: true })}
              >
                Yes, they were deleted
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => run()}>
              <RefreshCw className={pending ? 'animate-spin' : undefined} />
              Retry scan
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
              <AlertTriangle />
              Confirm deletion
            </Button>
            {moreMenu(false)}
          </>
        )}
        {removeDialog}
        {message && <span className="text-xs text-[var(--color-ink-faint)]">{message}</span>}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      {confirmingRestore ? (
        <div className="flex flex-col items-end gap-2 rounded-[var(--radius-control)] border border-[var(--color-danger)] bg-[var(--color-danger-soft)] p-3">
          <p className="max-w-sm text-right text-xs text-[var(--color-ink)]">
            Restore metadata from sidecar files? Existing PrintBench metadata for models and
            packages with .printbench.json or .printbench-package.json files will be replaced by
            metadata explicitly stored in those files. Models without a sidecar will not be changed.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => setConfirmingRestore(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={pending}
              onClick={() => run({ mode: 'deep', restoreSidecars: true })}
            >
              Restore metadata
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => run({ mode: 'fast' })}
          >
            <RefreshCw className={pending ? 'animate-spin' : undefined} />
            Scan
          </Button>
          {moreMenu(true)}
        </div>
      )}
      {removeDialog}
      {message && <span className="text-xs text-[var(--color-ink-faint)]">{message}</span>}
    </div>
  )
}
