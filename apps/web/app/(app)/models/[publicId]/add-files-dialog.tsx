'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FolderPlus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
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
export function AddFilesDialog({
  publicId,
  modelId,
  libraryId,
  isFileModel,
  fileName,
  open,
  onOpenChange: setOpen,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  publicId: string
  modelId: string
  libraryId: string
  isFileModel: boolean
  /** The loose file's name, for saying where it will move to. */
  fileName: string
}) {
  const router = useRouter()
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
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        // Closing mid-upload would unmount the uploads with it.
        if (!nextOpen && (busy || pending)) return
        setOpen(nextOpen)
        if (!nextOpen) setError(null)
      }}
    >
      <DialogContent
        title="Add files"
        description="More model files, sliced G-code, images or documents. They appear in the file list once the library has picked them up."
        hideClose={busy || pending}
      >
        {needsFolder ? (
          <div className="space-y-3">
            <p className="text-sm">
              This model is a single file, <span className="font-medium">{fileName}</span>, with no
              folder of its own yet. Adding files moves it into a new folder named after it. Its
              tags, notes, print history, collections and share link stay with it.
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
      </DialogContent>
    </Dialog>
  )
}
