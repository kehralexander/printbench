import { ModelCard, formatDimensions } from './model-card'

/** What a grid card needs; search hits, liked models and collection rows all fit it. */
export interface GridModel {
  publicId: string
  name: string
  path: string
  fileCount: number
  totalSize: number
  libraryName?: string
  previewExtension?: string | null
  isPackage?: boolean
  previewImageFileId?: string | null
  thumbFileId?: string | null
  thumbKey?: string | null
  bboxX?: number | null
  bboxY?: number | null
  bboxZ?: number | null
}

/**
 * The standard grid of model cards.
 *
 * Extracted because models, creators, tags, collections and liked all show the
 * same thing, and five copies of the card call is five places to forget a prop.
 */
export function ModelGrid({ models }: { models: readonly GridModel[] }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
      {models.map((model) => (
        <ModelCard
          key={model.publicId}
          publicId={model.publicId}
          name={model.name}
          path={model.path}
          fileCount={model.fileCount}
          totalSize={model.totalSize}
          libraryName={model.libraryName}
          previewExtension={model.previewExtension}
          isPackage={model.isPackage}
          previewImageFileId={model.previewImageFileId}
          thumbFileId={model.thumbFileId}
          thumbKey={model.thumbKey}
          dimensions={formatDimensions(model.bboxX ?? 0, model.bboxY ?? 0, model.bboxZ ?? 0)}
        />
      ))}
    </div>
  )
}
