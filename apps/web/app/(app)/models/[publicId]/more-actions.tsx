'use client'

import { useState } from 'react'
import { FilePlus2, FolderInput, Link2, MoreHorizontal, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AddFilesDialog } from './add-files-dialog'
import { DeleteDialog } from './delete-dialog'
import { MoveDialog } from './move-dialog'
import { ShareDialog } from './share-dialog'

type Action = 'share' | 'add-files' | 'move' | 'remove'

/**
 * The model page's occasional actions — share, add files, move, remove — in
 * one menu, so the header keeps only what is used on most visits. Each opens
 * its own dialog; only one can be open at a time.
 */
export function MoreActions({
  model,
  share,
  addFiles,
  canMove,
  remove,
}: {
  model: { publicId: string; name: string; libraryName: string }
  /** Present when the instance allows share links and this user may make one. */
  share?: { shareUrl: string | null }
  addFiles?: { modelId: string; libraryId: string; isFileModel: boolean; fileName: string }
  canMove: boolean
  remove?: { fileCount: number; canDeleteFiles: boolean }
}) {
  const [active, setActive] = useState<Action | null>(null)
  const dialog = (action: Action) => ({
    open: active === action,
    onOpenChange: (open: boolean) => setActive(open ? action : null),
  })

  if (!share && !addFiles && !canMove && !remove) return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label="More actions">
            <MoreHorizontal />
            <span className="hidden sm:inline">More</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {share && (
            <DropdownMenuItem onSelect={() => setActive('share')}>
              <Link2 />
              {share.shareUrl ? 'Shared link…' : 'Share by link…'}
            </DropdownMenuItem>
          )}
          {addFiles && (
            <DropdownMenuItem onSelect={() => setActive('add-files')}>
              <FilePlus2 />
              Add files…
            </DropdownMenuItem>
          )}
          {canMove && (
            <DropdownMenuItem onSelect={() => setActive('move')}>
              <FolderInput />
              Move to library…
            </DropdownMenuItem>
          )}
          {remove && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem tone="danger" onSelect={() => setActive('remove')}>
                <Trash2 />
                Remove…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {share && (
        <ShareDialog publicId={model.publicId} shareUrl={share.shareUrl} {...dialog('share')} />
      )}
      {addFiles && (
        <AddFilesDialog publicId={model.publicId} {...addFiles} {...dialog('add-files')} />
      )}
      {canMove && (
        <MoveDialog publicId={model.publicId} libraryName={model.libraryName} {...dialog('move')} />
      )}
      {remove && (
        <DeleteDialog
          publicId={model.publicId}
          name={model.name}
          libraryName={model.libraryName}
          {...remove}
          {...dialog('remove')}
        />
      )}
    </>
  )
}
