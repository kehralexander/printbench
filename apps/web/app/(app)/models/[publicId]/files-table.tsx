'use client'

import { useMemo, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ImageIcon, MoreHorizontal, Pencil, Search, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EditableNameRow } from '@/components/ui/editable-name-row'
import { Input } from '@/components/ui/input'
import { SectionHeader } from '@/components/ui/section-header'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/cn'
import { deleteFile } from './delete-file-actions'
import { saveModel } from './edit-actions'
import { FileDownloadLink } from './file-download-link'
import { groupFiles, type FileGroup } from './file-groups'
import { OpenInSlicer } from './open-in-slicer'
import { usePreview } from './preview-context'
import { renameFile } from './rename-file-actions'
import { SendToPrinter } from './send-to-printer'

export type TableFile = {
  id: string
  filename: string
  extension: string
  category: string
  size: string
  presupported: boolean
  missing_at: string | null
  triangle_count: number | null
  canOpenInSlicer: boolean
  canSendToPrinter: boolean
  thumbUrl: string | null
  /** Can stand in as the model's thumbnail: an image, or a file with a render. */
  canBeThumbnail: boolean
  /** This file is the model's chosen thumbnail. */
  isThumbnail: boolean
}

type Permissions = {
  /** The model whose files may be renamed; null when this viewer cannot. */
  renamePublicId: string | null
  /** The model whose files may be deleted; null when this viewer cannot. */
  deletePublicId: string | null
  /** The model whose thumbnail may be chosen; null when this viewer cannot. */
  thumbnailPublicId: string | null
}

const CATEGORY_ORDER = ['model', 'slicer', 'image', 'document', 'archive', 'video', 'other']
const CATEGORY_TABS: Record<string, string> = {
  model: '3D models',
  slicer: 'Sliced',
  image: 'Images',
  document: 'Documents',
  archive: 'Archives',
  video: 'Video',
  other: 'Other',
}

const NUMBER = new Intl.NumberFormat('en-GB')
const NATURAL = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

type Row = { category: string; group: FileGroup<TableFile> }

/** Projects before loose meshes: a 3MF usually is the whole model, set up. */
function extensionRank(extension: string): number {
  return extension === '3mf' ? 0 : extension === 'stl' ? 1 : 2
}

function buildRows(files: TableFile[]): Row[] {
  const byCategory = new Map<string, TableFile[]>()
  for (const file of files) {
    const category = CATEGORY_ORDER.includes(file.category) ? file.category : 'other'
    byCategory.set(category, [...(byCategory.get(category) ?? []), file])
  }

  const rows: Row[] = []
  for (const category of CATEGORY_ORDER) {
    const list = byCategory.get(category)
    if (!list) continue
    // Meshes are where variants pile up; other kinds are listed as they are.
    const groups =
      category === 'model'
        ? groupFiles(list).groups
        : list.map((file) => ({
            key: file.id,
            part: file.filename.split('/').pop() ?? file.filename,
            folder: file.filename.includes('/')
              ? file.filename.slice(0, file.filename.lastIndexOf('/'))
              : '',
            extension: file.extension.toLowerCase(),
            variants: [{ file, label: '' }],
          }))
    groups.sort(
      (a, b) =>
        extensionRank(a.extension) - extensionRank(b.extension) ||
        NATURAL.compare(a.folder, b.folder) ||
        NATURAL.compare(a.part, b.part),
    )
    for (const group of groups) rows.push({ category, group })
  }
  return rows
}

/**
 * Every file the model has, as one table: a part per row with its variants
 * folded into a picker, filterable by name and by kind. Picking a row shows
 * it in the viewer beside the page.
 */
export function FilesTable({
  files,
  permissions,
}: {
  files: TableFile[]
  permissions: Permissions
}) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string>('all')
  const rows = useMemo(() => buildRows(files), [files])

  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.category, (counts.get(row.category) ?? 0) + 1)
  const tabs = CATEGORY_ORDER.filter((key) => counts.has(key))

  const needle = query.trim().toLowerCase()
  const visible = rows.filter(
    (row) =>
      (category === 'all' || row.category === category) &&
      (!needle ||
        row.group.part.toLowerCase().includes(needle) ||
        row.group.variants.some(
          (variant) =>
            variant.file.filename.toLowerCase().includes(needle) ||
            variant.label.toLowerCase().includes(needle),
        )),
  )

  const parts = rows.filter((row) => row.category === 'model').length
  const meta =
    parts > 0 && parts < files.filter((file) => file.category === 'model').length
      ? `${files.length} · ${parts} ${parts === 1 ? 'part' : 'parts'} with variants folded`
      : String(files.length)

  return (
    <section>
      <SectionHeader
        title="Files"
        meta={meta}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <span className="sr-only">Filter files</span>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-ink-faint)]" />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter files…"
                className="h-8 w-48 pl-8"
              />
            </label>
            {tabs.length > 1 && (
              <div
                role="group"
                aria-label="Kind of file"
                className="flex rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5 text-xs"
              >
                {['all', ...tabs].map((key) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={category === key}
                    onClick={() => setCategory(key)}
                    className={cn(
                      'whitespace-nowrap rounded-[calc(var(--radius-control)-2px)] px-2.5 py-1',
                      category === key
                        ? 'bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]'
                        : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
                    )}
                  >
                    {key === 'all' ? 'All' : CATEGORY_TABS[key]}
                  </button>
                ))}
              </div>
            )}
          </div>
        }
      />
      <Card className="overflow-hidden">
        <Table className="min-w-[36rem] table-fixed">
          <THead>
            <TR>
              <TH>Name</TH>
              <TH className="w-48">Variant</TH>
              <TH className="hidden w-24 text-right 2xl:table-cell">Triangles</TH>
              <TH className="w-20 text-right">Size</TH>
              <TH className="relative w-36">
                <span className="sr-only">Actions</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {visible.map((row) => (
              <GroupRow key={row.group.key} group={row.group} permissions={permissions} />
            ))}
            {visible.length === 0 && (
              <TR>
                <TD colSpan={5} className="text-center text-[var(--color-ink-muted)]">
                  No files match “{query}”.
                </TD>
              </TR>
            )}
          </TBody>
        </Table>
      </Card>
      <p className="mt-2 text-xs text-[var(--color-ink-faint)]">
        Pick a 3D file or an image to show it in the viewer.
      </p>
    </section>
  )
}

function GroupRow({
  group,
  permissions,
}: {
  group: FileGroup<TableFile>
  permissions: Permissions
}) {
  const router = useRouter()
  const preview = usePreview()
  const [chosen, setChosen] = useState(0)
  const [renaming, setRenaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // Follow the viewer when it shows one of this part's variants.
  const showingIndex = group.variants.findIndex((variant) => preview.isShowing(variant.file.id))
  const index = Math.min(showingIndex >= 0 ? showingIndex : chosen, group.variants.length - 1)
  const file = group.variants[index]!.file
  const showing = showingIndex >= 0
  const previewable = preview.items.has(file.id) && !file.missing_at
  const name = file.filename.split('/').pop() ?? file.filename

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null)
    startTransition(async () => {
      const result = await action()
      if (!result.ok) {
        setError(result.error)
        return
      }
      setRenaming(false)
      router.refresh()
    })
  }

  function remove() {
    const publicId = permissions.deletePublicId
    if (!publicId) return
    if (!window.confirm(`Delete "${name}" from disk? This cannot be undone.`)) return
    run(() => deleteFile(publicId, file.id))
  }

  function toggleThumbnail() {
    const publicId = permissions.thumbnailPublicId
    if (!publicId) return
    run(() => saveModel(publicId, { previewFileId: file.isThumbnail ? null : file.id }))
  }

  function rename(next: string) {
    const publicId = permissions.renamePublicId
    if (!publicId) return
    if (next.trim() === name) {
      setRenaming(false)
      return
    }
    run(() => renameFile(publicId, file.id, next))
  }

  const menu = !file.missing_at && [
    permissions.renamePublicId && (
      <DropdownMenuItem key="rename" onSelect={() => setRenaming(true)}>
        <Pencil />
        Rename…
      </DropdownMenuItem>
    ),
    permissions.thumbnailPublicId && file.canBeThumbnail && (
      <DropdownMenuItem key="thumbnail" onSelect={toggleThumbnail}>
        <ImageIcon />
        {file.isThumbnail ? 'Use the automatic thumbnail' : 'Use as thumbnail'}
      </DropdownMenuItem>
    ),
  ]
  const menuItems = (menu || []).filter(Boolean) as ReactNode[]
  const canDelete = permissions.deletePublicId != null

  return (
    <TR
      aria-selected={showing || undefined}
      onClick={() => previewable && !renaming && preview.show(file.id)}
      className={cn(
        previewable && 'cursor-pointer hover:bg-[var(--color-surface-2)]',
        showing &&
          'bg-[var(--color-accent-soft)] shadow-[inset_3px_0_0_var(--color-accent)] hover:bg-[var(--color-accent-soft)]',
        file.missing_at && 'opacity-50',
      )}
    >
      <TD className="py-2">
        <div className="flex min-w-0 items-center gap-3">
          {file.thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={file.thumbUrl}
              alt=""
              loading="lazy"
              className="size-9 shrink-0 rounded bg-[var(--color-surface-2)] object-contain"
            />
          ) : (
            <span className="flex size-9 shrink-0 items-center justify-center rounded bg-[var(--color-surface-2)] text-[10px] font-semibold uppercase text-[var(--color-ink-faint)]">
              {group.extension || '?'}
            </span>
          )}
          {renaming ? (
            <EditableNameRow
              initial={name}
              label={`New name for ${name}`}
              pending={pending}
              onSave={rename}
              onCancel={() => {
                setRenaming(false)
                setError(null)
              }}
              className="max-w-none flex-1"
            />
          ) : (
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium" title={file.filename}>
                  {group.part}
                </span>
                {file.isThumbnail && (
                  <Badge tone="accent" className="shrink-0">
                    thumbnail
                  </Badge>
                )}
                {file.presupported && (
                  <Badge tone="accent" className="shrink-0">
                    supported
                  </Badge>
                )}
                {file.missing_at && (
                  <Badge tone="danger" className="shrink-0">
                    missing
                  </Badge>
                )}
              </div>
              <div className="flex min-w-0 gap-1.5 text-xs text-[var(--color-ink-faint)]">
                <span className="shrink-0 uppercase">{group.extension || 'file'}</span>
                {group.folder && (
                  <span className="truncate" title={group.folder}>
                    · {group.folder}
                  </span>
                )}
                {showing && (
                  <span className="shrink-0 font-medium text-[var(--color-accent)]">
                    · in the viewer
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
        {error && <p className="mt-1 text-xs text-[var(--color-danger)]">{error}</p>}
      </TD>

      <TD className="py-2">
        {group.variants.length > 1 ? (
          <span className="relative block" onClick={(event) => event.stopPropagation()}>
            <select
              aria-label={`Variant of ${group.part}`}
              value={file.id}
              onChange={(event) => {
                const next = group.variants.findIndex((v) => v.file.id === event.target.value)
                setChosen(next)
                const picked = group.variants[next]!.file
                // Switching the variant of the part in view swaps the model too.
                if (showing && preview.items.has(picked.id)) preview.show(picked.id)
              }}
              className="h-8 w-full appearance-none truncate rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] pl-2.5 pr-14 text-sm"
            >
              {group.variants.map((variant) => (
                <option key={variant.file.id} value={variant.file.id}>
                  {variant.label}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 text-xs text-[var(--color-ink-faint)]">
              of {group.variants.length}
              <ChevronDown className="size-3.5" />
            </span>
          </span>
        ) : (
          <span className="text-[var(--color-ink-faint)]">—</span>
        )}
      </TD>

      <TD className="hidden whitespace-nowrap py-2 text-right text-[var(--color-ink-muted)] 2xl:table-cell">
        {file.triangle_count != null ? NUMBER.format(file.triangle_count) : '—'}
      </TD>

      <TD className="whitespace-nowrap py-2 text-right text-[var(--color-ink-muted)]">
        {formatBytes(Number(file.size))}
      </TD>

      <TD className="py-2 pl-0 pr-2">
        {!file.missing_at || canDelete ? (
          <div
            className="flex items-center justify-end"
            onClick={(event) => event.stopPropagation()}
          >
            {!file.missing_at && (
              <>
                {file.canSendToPrinter && (
                  <SendToPrinter fileId={file.id} filename={file.filename} iconOnly />
                )}
                {file.canOpenInSlicer && (
                  <OpenInSlicer fileId={file.id} filename={file.filename} iconOnly />
                )}
                <FileDownloadLink fileId={file.id} filename={file.filename} />
              </>
            )}
            {(menuItems.length > 0 || canDelete) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    disabled={pending}
                    aria-label={`More actions for ${name}`}
                    title="More"
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {menuItems}
                  {canDelete && (
                    <>
                      {menuItems.length > 0 && <DropdownMenuSeparator />}
                      <DropdownMenuItem tone="danger" onSelect={remove}>
                        <Trash2 />
                        Delete from disk…
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        ) : null}
      </TD>
    </TR>
  )
}
