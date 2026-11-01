import { sql, type SQL } from 'drizzle-orm'
import { THUMBNAIL_SLICER_EXTENSIONS } from './slicer-metadata-service'

/**
 * Files the worker derives anything for: meshes it can parse, and sliced files
 * that may carry an embedded preview image. `alias` is a table alias written
 * in the calling query, never user input.
 */
export function derivedWorkFileSql(alias: string): SQL {
  const file = sql.raw(alias)
  const extensions = sql.join(
    THUMBNAIL_SLICER_EXTENSIONS.map((extension) => sql`${extension}`),
    sql`, `,
  )
  return sql`(${file}.previewable OR ${file}.extension IN (${extensions}))`
}

/**
 * A model's format is independent of its artwork. Prefer its selected 3D file,
 * then another live 3D file; slicer files are a fallback for print-only models.
 * Image-only packages have no model format badge.
 *
 * The caller supplies SQL expressions from its model row, never user strings.
 */
export function modelFormatSql(modelId: SQL, previewFileId: SQL): SQL {
  return sql`(
    SELECT format_file.extension FROM model_files format_file
    WHERE format_file.model_id = ${modelId} AND format_file.missing_at IS NULL
      AND format_file.category IN ('model', 'slicer')
    ORDER BY (format_file.category = 'model') DESC,
             (format_file.id = ${previewFileId}) DESC NULLS LAST,
             format_file.size DESC, format_file.filename COLLATE "C", format_file.id
    LIMIT 1
  )`
}

/**
 * Geometry is measured from an analyzed 3D file, even when the chosen artwork
 * is an image or thumbnail rendering failed. Use this once in a LATERAL join
 * so all three dimensions describe the same file.
 */
export function modelGeometrySql(modelId: SQL, previewFileId: SQL): SQL {
  return sql`
    SELECT geometry_file.id, geometry_file.bbox_x, geometry_file.bbox_y, geometry_file.bbox_z
    FROM model_files geometry_file
    WHERE geometry_file.model_id = ${modelId} AND geometry_file.missing_at IS NULL
      AND geometry_file.category = 'model' AND geometry_file.analysis_state = 'ok'
      AND geometry_file.bbox_x > 0 AND geometry_file.bbox_y > 0 AND geometry_file.bbox_z >= 0
    ORDER BY (geometry_file.id = ${previewFileId}) DESC NULLS LAST,
             geometry_file.size DESC, geometry_file.filename COLLATE "C", geometry_file.id
    LIMIT 1
  `
}

/**
 * Keep the thumbnail file and its cache version from the same live row.
 *
 * A slicer's embedded preview is a small fallback image, so any mesh render or
 * picture of the model itself wins over it regardless of file size.
 */
export function modelThumbnailSql(modelId: SQL, previewFileId: SQL): SQL {
  return sql`
    SELECT thumbnail_file.id, thumbnail_file.thumb_key
    FROM model_files thumbnail_file
    WHERE thumbnail_file.model_id = ${modelId} AND thumbnail_file.missing_at IS NULL
      AND thumbnail_file.thumb_state = 'ok'
    ORDER BY (thumbnail_file.id = ${previewFileId}) DESC NULLS LAST,
             (thumbnail_file.category = 'slicer'),
             thumbnail_file.size DESC, thumbnail_file.filename COLLATE "C", thumbnail_file.id
    LIMIT 1
  `
}
