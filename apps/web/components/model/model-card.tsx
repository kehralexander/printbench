import Link from 'next/link'
import { FileStack, Package } from 'lucide-react'
import { cn } from '@/lib/cn'
import { CardPreview } from './card-preview'

import { formatBytes } from '@/lib/format'

export { formatBytes }

/** Millimetres, rounded the way a printer would quote them. */
export function formatDimensions(x?: number, y?: number, z?: number): string | null {
  if (!x || !y) return null
  const round = (value: number) => (value >= 100 ? Math.round(value) : Math.round(value * 10) / 10)
  return `${round(x)} × ${round(y)} × ${round(z ?? 0)} mm`
}

export interface ModelCardProps {
  publicId: string
  name: string
  path: string
  fileCount: number
  totalSize: number
  libraryName?: string
  /** Printable model format, independent of the file used as its artwork. */
  previewExtension?: string | null
  isPackage?: boolean
  /** Selected creator-supplied image, served directly instead of as a generated mesh thumbnail. */
  previewImageFileId?: string | null
  /** Set once a thumbnail has been rendered for the preview file. */
  thumbFileId?: string | null
  /** Content-addressed cache version; changes when the thumbnail is regenerated. */
  thumbKey?: string | null
  dimensions?: string | null
}

export function ModelCard({
  publicId,
  name,
  path,
  fileCount,
  totalSize,
  libraryName,
  previewExtension,
  isPackage,
  previewImageFileId,
  thumbFileId,
  thumbKey,
  dimensions,
}: ModelCardProps) {
  const hue = hashHue(publicId)

  return (
    <Link
      href={`/models/${publicId}`}
      className={cn(
        'group flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]',
        'transition-shadow hover:shadow-[var(--shadow-card)]',
      )}
    >
      <div
        className="relative flex aspect-[4/3] items-center justify-center overflow-hidden"
        style={{
          // The placeholder colour; once a picture exists CardPreview paints its
          // own lighter tint behind it, so a transparent render still sits on
          // something rather than floating on the card colour.
          background: `linear-gradient(145deg, oklch(72% 0.07 ${hue}) 0%, oklch(58% 0.09 ${hue + 24}) 100%)`,
        }}
      >
        <CardPreview
          publicId={publicId}
          previewImageFileId={previewImageFileId}
          thumbFileId={thumbFileId}
          thumbKey={thumbKey}
          hue={hue}
        />
        {previewExtension && (
          <span className="absolute bottom-2 right-2 rounded bg-black/35 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/90 backdrop-blur-sm">
            {previewExtension}
          </span>
        )}
        {isPackage && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded bg-black/45 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/90 backdrop-blur-sm">
            <Package className="size-3" />
            Package
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3
          className="line-clamp-2 text-sm font-medium leading-snug group-hover:text-[var(--color-accent)]"
          title={name}
        >
          {name}
        </h3>
        <p className="truncate text-xs text-[var(--color-ink-faint)]" title={path}>
          {/*
           * The folder is usually named after the model, and the title above
           * already says that; the path only earns its place when it adds a
           * parent folder or a different name.
           */}
          {[libraryName, path.toLowerCase() === name.toLowerCase() ? null : path]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {(fileCount > 0 || totalSize > 0) && (
          <p className="mt-auto flex items-center gap-1.5 pt-1 text-xs text-[var(--color-ink-muted)]">
            <FileStack className="size-3" />
            {fileCount} file{fileCount === 1 ? '' : 's'}
            <span aria-hidden>·</span>
            {formatBytes(totalSize)}
          </p>
        )}
        {dimensions && (
          <p className="truncate text-xs tabular-nums text-[var(--color-ink-faint)]">
            {dimensions}
          </p>
        )}
      </div>
    </Link>
  )
}

/** Stable hue from an id, so a model keeps the same placeholder colour. */
function hashHue(seed: string): number {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 360
  }
  return hash
}
