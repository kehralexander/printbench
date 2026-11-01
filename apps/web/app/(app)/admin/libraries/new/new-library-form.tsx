'use client'

import * as React from 'react'
import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  Boxes,
  Check,
  Cloud,
  FolderSearch,
  HardDrive,
  Loader2,
  Upload,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Callout } from '@/components/ui/callout'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/cn'
import {
  createLibrary,
  previewLibrary,
  uploadLocation,
  type PreviewResult,
  type S3Config,
} from '../actions'
import { FolderPicker } from './folder-picker'
import { S3Fields } from './s3-fields'

type GroupingMode = 'deepest' | 'top_level' | 'flat'
type Kind = 'in_place' | 'managed'
type Backend = 'local' | 's3'

const MODES: { value: GroupingMode; label: string; description: string }[] = [
  {
    value: 'deepest',
    label: 'Each folder',
    description: 'Every folder holding model files becomes a model. Right for most collections.',
  },
  {
    value: 'top_level',
    label: 'Top level',
    description:
      'A folder and everything beneath it is one model. Good when a set has variants in sub-folders.',
  },
  {
    value: 'flat',
    label: 'Fixed depth',
    description: 'Only folders at a set depth become models. For rigidly organised libraries.',
  },
]

/**
 * Adding a library.
 *
 * Two decisions, in the order they actually get made. First: are you pointing
 * at files you already have, or making somewhere to put new ones? That is what
 * "in place" and "managed" meant, and naming them that way made the choice
 * unanswerable for anyone who had not read the source.
 *
 * Second, only for existing files: which folder — chosen by looking at what is
 * there, not by typing a path that depends on how the container is mounted.
 */
export function NewLibraryForm() {
  const router = useRouter()

  const [kind, setKind] = useState<Kind | null>(null)
  const [backend, setBackend] = useState<Backend | null>(null)
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [s3, setS3] = useState<S3Config>({ bucket: '' })
  const [mode, setMode] = useState<GroupingMode>('deepest')
  const [depth, setDepth] = useState(1)
  const [writeSidecar, setWriteSidecar] = useState(true)
  const [uploadRoot, setUploadRoot] = useState<string | null>(null)

  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, startSaving] = useTransition()

  useEffect(() => {
    if (kind !== 'managed' || uploadRoot !== null) return
    void uploadLocation().then((location) => setUploadRoot(location.root))
  }, [kind, uploadRoot])

  async function runPreview(nextMode: GroupingMode = mode, nextDepth: number = depth) {
    if (backend === 's3') {
      if (!s3.bucket.trim()) {
        setError('Give the bucket a name first.')
        return
      }
    } else if (!path) {
      setError('Choose a folder first.')
      return
    }

    setError(null)
    setPreviewing(true)
    try {
      const result = await previewLibrary(
        backend === 's3'
          ? { s3, groupingMode: nextMode, groupingDepth: nextDepth }
          : { path, groupingMode: nextMode, groupingDepth: nextDepth },
      )
      setPreview(result)
      if (!result.ok && result.error) setError(result.error)
      // Seed the name once we know the location is real.
      if (result.ok && !name.trim()) {
        const seed =
          backend === 's3'
            ? s3.bucket
            : path
                .replace(/[\\/]+$/, '')
                .split(/[\\/]/)
                .pop()
        if (seed) setName(seed)
      }
    } finally {
      setPreviewing(false)
    }
  }

  function changeMode(next: GroupingMode) {
    setMode(next)
    if (preview?.ok) void runPreview(next, depth)
  }

  function save() {
    setError(null)
    startSaving(async () => {
      const result = await createLibrary({
        name,
        // An uploads library derives its own folder; there is nothing to send.
        path: backend === 'local' && kind === 'in_place' ? path : undefined,
        s3: backend === 's3' ? s3 : undefined,
        kind: kind ?? 'in_place',
        groupingMode: mode,
        groupingDepth: mode === 'flat' ? depth : undefined,
        writeSidecar,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.push('/admin/libraries')
      router.refresh()
    })
  }

  /* ------------------------------------------------- step 1: which kind */

  if (kind === null) {
    return (
      <div className="max-w-2xl space-y-6">
        <p className="text-sm text-[var(--color-ink-muted)]">What is this library for?</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <ChoiceCard
            icon={<HardDrive />}
            title="Files I already have"
            description="Point at a folder of STLs and 3MFs. They are indexed where they sit and are never moved, renamed or deleted."
            note="This is what almost everyone wants."
            onClick={() => setKind('in_place')}
          />
          <ChoiceCard
            icon={<Upload />}
            title="Somewhere to upload to"
            description="A folder this app owns and writes to, so you can add models through the browser. It starts empty."
            note="You need one of these before the Upload page can do anything."
            onClick={() => setKind('managed')}
          />
        </div>

        <Button variant="ghost" onClick={() => router.push('/admin/libraries')}>
          Cancel
        </Button>
      </div>
    )
  }

  /* ------------------------------------------ step 1b: where it lives */

  if (backend === null) {
    return (
      <div className="max-w-2xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-[var(--color-ink-muted)]">
            {kind === 'managed' ? 'Where should uploads be stored?' : 'Where are these files?'}
          </p>
          <Button variant="ghost" size="sm" onClick={() => setKind(null)}>
            Back
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <ChoiceCard
            icon={<HardDrive />}
            title="On this server"
            description={
              kind === 'managed'
                ? 'A folder alongside the application’s own data, so it is covered by the same backup.'
                : 'A local disk or a mounted NAS share. Chosen by browsing what is there.'
            }
            onClick={() => setBackend('local')}
          />
          <ChoiceCard
            icon={<Cloud />}
            title="S3-compatible storage"
            description={
              kind === 'managed'
                ? 'A bucket this app uploads into: AWS S3, MinIO, Backblaze, or anything speaking the same API.'
                : 'A bucket you already have files in: AWS S3, MinIO, Backblaze, or anything speaking the same API.'
            }
            onClick={() => setBackend('s3')}
          />
        </div>
      </div>
    )
  }

  /* ------------------------------------- step 2a: a library for uploads */

  if (kind === 'managed') {
    const readyToCreate = name.trim() !== '' && (backend !== 's3' || s3.bucket.trim() !== '')

    return (
      <div className="max-w-2xl space-y-6">
        <Card>
          <CardContent className="space-y-4 p-5">
            <p className="flex items-start gap-2 text-sm text-[var(--color-ink-muted)]">
              <Upload className="mt-0.5 size-4 shrink-0 text-[var(--color-ink-faint)]" />
              {backend === 's3'
                ? 'Uploads are written straight into this bucket, in parts, so a multi-gigabyte model never has to fit in the server’s memory.'
                : 'A folder is created for this library and the app writes uploads into it. You do not choose where. It lives with the application’s own data so it is covered by the same backup.'}
            </p>

            <Field
              label="Library name"
              htmlFor="name"
              hint={backend === 's3' ? undefined : 'Used for the folder name too.'}
            >
              <Input
                name="name"
                autoFocus={backend !== 's3'}
                value={name}
                placeholder="Uploads"
                onChange={(e) => setName(e.target.value)}
              />
            </Field>

            {backend === 's3' ? (
              <S3Fields
                value={s3}
                onChange={(next) => {
                  setS3(next)
                  setError(null)
                }}
              />
            ) : (
              uploadRoot && (
                <p className="font-mono text-xs text-[var(--color-ink-faint)]">
                  Will be created under {uploadRoot}
                </p>
              )
            )}

            {error && (
              <p role="alert" className="text-sm text-[var(--color-danger)]">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setBackend(null)}>
                Back
              </Button>
              <Button disabled={saving || !readyToCreate} onClick={save}>
                {saving ? 'Creating…' : 'Create library'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  /* ------------------ step 2b: point at an existing folder, or a bucket */

  const ready = backend === 's3' ? Boolean(s3.bucket.trim()) : Boolean(path)

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle>
            {backend === 's3' ? 'Connect the bucket' : 'Choose the folder holding your models'}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => setBackend(null)}>
            Back
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {backend === 's3' ? (
            <S3Fields
              value={s3}
              onChange={(next) => {
                setS3(next)
                setPreview(null)
                setError(null)
              }}
            />
          ) : (
            <>
              <FolderPicker
                value={path}
                onChange={(next) => {
                  setPath(next)
                  setPreview(null)
                  setError(null)
                }}
              />

              {path && (
                <p className="truncate font-mono text-xs text-[var(--color-ink-muted)]">{path}</p>
              )}
            </>
          )}

          <Button
            variant="secondary"
            disabled={previewing || !ready}
            onClick={() => void runPreview()}
          >
            {previewing ? <Loader2 className="animate-spin" /> : <FolderSearch />}
            {previewing ? 'Looking…' : 'Preview what will be indexed'}
          </Button>

          {error && (
            <p role="alert" className="text-sm text-[var(--color-danger)]">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      {/*
        The dry run is the point of this screen. The folder-to-model heuristic
        is the riskiest logic in the app, so it gets shown and corrected BEFORE
        anything is written, rather than discovered afterwards.
      */}
      {preview?.ok && (
        <Card>
          <CardHeader>
            <CardTitle>How folders are grouped</CardTitle>
            <CardDescription>
              Which folders become models. The preview below updates as you change it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-3">
              {MODES.map((option) => (
                <ChoiceCard
                  key={option.value}
                  compact
                  selected={mode === option.value}
                  title={option.label}
                  description={option.description}
                  onClick={() => changeMode(option.value)}
                />
              ))}
            </div>

            {mode === 'flat' && (
              <div className="mt-3 max-w-40">
                <Field label="Depth" htmlFor="depth">
                  <Input
                    name="depth"
                    type="number"
                    min={1}
                    max={6}
                    value={depth}
                    onChange={(e) => {
                      const next = Number(e.target.value)
                      setDepth(next)
                      void runPreview(mode, next)
                    }}
                  />
                </Field>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {preview?.ok && (
        <Card>
          <CardHeader>
            <CardTitle>What will be indexed</CardTitle>
            <CardDescription>
              {preview.fileCount} files · {preview.containerCount} folders treated as groups
              {preview.samples.length > 0 && '. A sample of the models it would create is below.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-sm">
              <span className="text-2xl font-semibold tabular-nums">{preview.modelCount}</span>{' '}
              <span className="text-[var(--color-ink-muted)]">models</span>
            </p>

            {preview.warnings.map((warning) => (
              <Callout key={warning} tone="warning" icon={<AlertTriangle />}>
                {warning}
              </Callout>
            ))}

            {preview.samples.length > 0 && (
              <div>
                <ul className="divide-y divide-[var(--color-border)] rounded-[var(--radius-control)] border border-[var(--color-border)]">
                  {preview.samples.map((sample) => (
                    <li key={sample.path} className="flex items-center gap-3 px-3 py-2">
                      <Boxes className="size-4 shrink-0 text-[var(--color-ink-faint)]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{sample.name}</span>
                        <span className="block truncate font-mono text-xs text-[var(--color-ink-faint)]">
                          {sample.path}
                        </span>
                      </span>
                      {sample.isFileModel && <Badge tone="neutral">single file</Badge>}
                      <span className="shrink-0 text-xs tabular-nums text-[var(--color-ink-muted)]">
                        {sample.fileCount} file{sample.fileCount === 1 ? '' : 's'}
                      </span>
                    </li>
                  ))}
                </ul>
                {preview.modelCount > preview.samples.length && (
                  <p className="mt-2 text-xs text-[var(--color-ink-faint)]">
                    …and {preview.modelCount - preview.samples.length} more.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {preview?.ok && (
        <Card>
          <CardContent className="space-y-4 p-5">
            <Field label="Library name" htmlFor="name">
              <Input name="name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>

            <label className="flex cursor-pointer items-start gap-3">
              <Checkbox
                checked={writeSidecar}
                onChange={(e) => setWriteSidecar(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-sm">
                <span className="font-medium">Write a metadata sidecar into each model folder</span>
                <span className="mt-0.5 block text-[var(--color-ink-muted)]">
                  Saves tags, creator and notes to a small{' '}
                  <code className="font-mono text-xs">.printbench.json</code> file, so your metadata
                  survives a database loss and moves with the files. This is the only thing ever
                  written into an indexed folder. Your model files are never touched.
                </span>
              </span>
            </label>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => router.push('/admin/libraries')}>
                Cancel
              </Button>
              <Button disabled={saving || !name.trim()} onClick={save}>
                {saving ? 'Adding…' : 'Add library'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

/**
 * One option of a choice made by clicking a card: the kind of library, where
 * it lives, how its folders are grouped. `compact` is for a row of three.
 */
function ChoiceCard({
  icon,
  title,
  description,
  note,
  selected = false,
  compact = false,
  onClick,
}: {
  icon?: React.ReactNode
  title: string
  description: React.ReactNode
  note?: string
  selected?: boolean
  compact?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'rounded-[var(--radius-card)] border text-left transition-colors',
        compact ? 'p-3' : 'p-5',
        selected
          ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
          : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)]',
      )}
    >
      {icon && <span className="mb-3 block text-[var(--color-accent)] [&_svg]:size-5">{icon}</span>}
      <span className={cn('flex items-center gap-1.5 font-medium', compact && 'text-sm')}>
        {title}
        {selected && <Check className="size-3.5" />}
      </span>
      <span
        className={cn('mt-1 block text-[var(--color-ink-muted)]', compact ? 'text-xs' : 'text-sm')}
      >
        {description}
      </span>
      {note && <span className="mt-2 block text-xs text-[var(--color-ink-faint)]">{note}</span>}
    </button>
  )
}
