'use client'

import { useState } from 'react'
import Link from 'next/link'
import { LibraryBig } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Field } from '@/components/ui/field'
import { Select } from '@/components/ui/select'
import type { UploadTarget } from './actions'
import { UploadDropzone } from './upload-dropzone'
import { ModelSourceImportForm } from './model-source-import-form'

export function UploadWorkspace({ targets }: { targets: UploadTarget[] }) {
  const [libraryId, setLibraryId] = useState(targets[0]?.id ?? '')
  const [uploadBusy, setUploadBusy] = useState(false)
  const [importBusy, setImportBusy] = useState(false)

  if (targets.length === 0) {
    return (
      <EmptyState
        icon={<LibraryBig />}
        title="Add a library to get started"
        description="Uploads and imports need a managed library where PrintBench can save your models."
        action={
          <Button asChild variant="secondary">
            <Link href="/admin/libraries/new">Create a managed library</Link>
          </Button>
        }
        className="max-w-3xl"
      />
    )
  }

  return (
    <Card className="max-w-3xl">
      <CardContent className="space-y-5 p-4 sm:p-6">
        <Field label="Save to library" htmlFor="upload-library">
          <Select
            value={libraryId}
            onChange={(event) => setLibraryId(event.target.value)}
            disabled={uploadBusy || importBusy}
          >
            {targets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.name}
              </option>
            ))}
          </Select>
        </Field>
        <section aria-label="Upload local files" className="space-y-2">
          <UploadDropzone libraryId={libraryId} onBusyChange={setUploadBusy} />
          <p className="text-xs text-[var(--color-ink-muted)]">
            3MF files can fill in model details. Large uploads resume if your connection drops.
          </p>
        </section>
        <div
          className="flex items-center gap-3 text-xs text-[var(--color-ink-muted)]"
          aria-hidden="true"
        >
          <div className="h-px flex-1 bg-[var(--color-border)]" />
          <span>or paste a model link</span>
          <div className="h-px flex-1 bg-[var(--color-border)]" />
        </div>
        <ModelSourceImportForm libraryId={libraryId} onBusyChange={setImportBusy} />
      </CardContent>
    </Card>
  )
}
