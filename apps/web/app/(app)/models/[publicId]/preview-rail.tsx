'use client'

import { Box, ImageIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { ModelViewer } from '@/components/viewer/model-viewer'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/cn'
import { FileDownloadLink } from './file-download-link'
import { OpenInSlicer } from './open-in-slicer'
import { usePreview } from './preview-context'

const NUMBER = new Intl.NumberFormat('en-GB')

/**
 * The model's picture and 3D view, at the top of the rail beside the page.
 *
 * What it shows follows the files table: picking a mesh there loads it here,
 * picking an image shows that image. The caption says which file it is and
 * carries that file's actions, so a part can be inspected and downloaded
 * without scrolling back to its row.
 */
export function PreviewRail({
  name,
  artwork,
  thumbnail,
  maxBytes,
}: {
  name: string
  /** The model's chosen or rendered picture, shown before anything is picked. */
  artwork: { url: string; fileId: string | null; filename: string | null } | null
  /** A render to show behind the viewer while a mesh loads. */
  thumbnail: { fileId: string; key: string | null } | null
  maxBytes: number
}) {
  const { items, meshId, imageId, view, modelVisited, setView } = usePreview()
  const mesh = meshId ? items.get(meshId) : undefined
  const image = imageId ? items.get(imageId) : undefined
  const imageUrl = image?.imageUrl ?? artwork?.url ?? null

  if (!mesh && !imageUrl) return null

  const shown =
    view === 'model' && mesh
      ? mesh
      : (image ?? (artwork?.fileId ? items.get(artwork.fileId) : undefined))
  const captionName =
    view === 'model' && mesh ? mesh.filename : (image?.filename ?? artwork?.filename ?? 'Thumbnail')
  const details = shown
    ? [
        shown.kind === 'mesh' && shown.format ? shown.format.toUpperCase() : null,
        shown.triangles != null ? `${NUMBER.format(shown.triangles)} tris` : null,
        formatBytes(shown.size),
        shown.dimensions,
      ].filter(Boolean)
    : []

  return (
    <Card className="overflow-hidden">
      <section aria-label={`Preview of ${name}`} className="relative">
        {imageUrl && (
          <div
            hidden={view !== 'image'}
            className="aspect-square bg-[var(--color-surface-2)] lg:aspect-[4/3] 2xl:aspect-square"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt={image ? image.filename : `Thumbnail of ${name}`}
              className="size-full object-contain"
            />
          </div>
        )}
        {mesh?.format && modelVisited && (
          <div hidden={view !== 'model'}>
            <ModelViewer
              key={mesh.id}
              fileId={mesh.id}
              format={mesh.format}
              fileSize={mesh.size}
              filename={mesh.filename.split('/').pop() ?? mesh.filename}
              thumbnailFileId={thumbnail?.fileId ?? null}
              thumbnailKey={thumbnail?.key ?? null}
              maxBytes={maxBytes}
              active={view === 'model'}
              className="aspect-square rounded-none border-0 lg:aspect-[4/3] 2xl:aspect-square"
            />
          </div>
        )}

        {imageUrl && mesh && (
          <div
            role="group"
            aria-label="Preview mode"
            className="absolute left-3 top-3 flex rounded-[var(--radius-control)] bg-black/50 p-0.5 text-xs text-white backdrop-blur-sm"
          >
            <ModeButton active={view === 'image'} onClick={() => setView('image')}>
              <ImageIcon />
              Image
            </ModeButton>
            <ModeButton active={view === 'model'} onClick={() => setView('model')}>
              <Box />
              3D
            </ModeButton>
          </div>
        )}
      </section>

      <div className="flex items-center gap-2 border-t border-[var(--color-border)] py-2 pl-3 pr-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={captionName}>
            {captionName.split('/').pop()}
          </p>
          {details.length > 0 && (
            <p className="truncate text-xs tabular-nums text-[var(--color-ink-faint)]">
              {details.join(' · ')}
            </p>
          )}
        </div>
        {shown?.canOpenInSlicer && (
          <OpenInSlicer fileId={shown.id} filename={shown.filename} iconOnly />
        )}
        {shown && <FileDownloadLink fileId={shown.id} filename={shown.filename} />}
      </div>
    </Card>
  )
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 rounded-[calc(var(--radius-control)-2px)] px-2 py-1 [&_svg]:size-3.5',
        active ? 'bg-white/25' : 'opacity-75 hover:opacity-100',
      )}
    >
      {children}
    </button>
  )
}
