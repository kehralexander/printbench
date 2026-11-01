'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import * as Dialog from '@radix-ui/react-dialog'
import { FilePlus2, FolderPlus, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { UploadDropzone } from '../../upload/upload-dropzone'
import { convertToFolder } from './add-files-actions'

/**
 * Adding files — another plate, a sliced .gcode, a photo of the print — to a
 * model that already exists, instead of uploading into the library and hoping
 * the grouping puts it in the right place.
 *
 * A single-file model has no folder to add to, so it gets one first, as a
 * step the user confirms: it moves a file they can see on disk.
 */
export function AddFilesButton({
  publicId,
  modelId,
  libraryId,
  isFileModel,
  fileName,
}: {
  publicId: string
  modelId: string
  libraryId: string
  isFileModel: boolean
  /** The loose file's name, for saying where it will move to. */
  fileName: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [converted, setConverted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const needsFolder = isFileModel && !converted

  function convert() {
    setError(null)
    startTransition(async () => {
      const result = await convertToFolder(publicId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setConverted(true)
      router.refresh()
    })
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        // Closing mid-upload would unmount the uploads with it.
        if (!nextOpen && (busy || pending)) return
        setOpen(nextOpen)
        if (!nextOpen) setError(null)
      }}
    >
      <Dialog.Trigger asChild>
        <Button variant="ghost" size="sm" title="Add files to this model">
          <FilePlus2 />
          <span className="hidden sm:inline">Add files</span>
        </Button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xl">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold">Add files</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-[var(--color-ink-muted)]">
                More model files, sliced G-code, images or documents. They appear in the file list
                once the library has picked them up.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="sm" aria-label="Close" disabled={busy || pending}>
                <X />
              </Button>
            </Dialog.Close>
          </div>

          {needsFolder ? (
            <div className="space-y-3">
              <p className="text-sm">
                This model is a single file, <span className="font-medium">{fileName}</span>, with
                no folder of its own yet. Adding files moves it into a new folder named after it.
                Its tags, notes, print history, collections and share link stay with it.
              </p>
              <Button size="sm" disabled={pending} onClick={convert}>
                {pending ? <Loader2 className="animate-spin" /> : <FolderPlus />}
                Move into a folder
              </Button>
            </div>
          ) : (
            <UploadDropzone libraryId={libraryId} modelId={modelId} onBusyChange={setBusy} />
          )}

          {error && (
            <p role="alert" className="mt-3 text-sm text-[var(--color-danger)]">
              {error}
            </p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
