import { notFound } from 'next/navigation'
import { sql } from 'drizzle-orm'
import { Box, Download, FileStack } from 'lucide-react'
import { getSettings, modelByShareToken } from '@pb/core'
import { getDb } from '@pb/db'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SectionHeader } from '@/components/ui/section-header'
import { PageHeader } from '@/components/shell/page-header'
import { formatBytes } from '@/lib/format'
import { compareFiles } from '@/app/(app)/models/[publicId]/file-tree-order'
import { ShareViewer } from './share-viewer'

export const dynamic = 'force-dynamic'

/**
 * A shared model, viewable without an account.
 *
 * Everything on this page is scoped to the one model the token names. There is
 * no navigation, no search and no link back into the app, because a share link
 * grants exactly one model — anything else here would be a way to explore the
 * library from outside it.
 */

type FileRow = {
  id: string
  filename: string
  extension: string
  category: string
  size: string
  thumb_state: string
  thumb_key: string | null
}

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const db = getDb()

  const { publicSharing } = await getSettings(db)
  if (!publicSharing) return { title: 'Not available' }

  const model = await modelByShareToken(db, token)
  return {
    title: model ? `${model.name} · Shared` : 'Not available',
    // A shared link should not end up in a search index.
    robots: { index: false, follow: false },
  }
}

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const db = getDb()

  /*
   * The instance-wide switch is checked first and fails the same way as a bad
   * token. Turning sharing off must close existing links immediately, without
   * having to revoke each one.
   */
  const { publicSharing, siteName } = await getSettings(db)
  if (!publicSharing) notFound()

  const model = await modelByShareToken(db, token)
  if (!model) notFound()

  const files = await db.execute<FileRow>(sql`
    SELECT id, filename, extension, category, size, thumb_state, thumb_key
    FROM model_files
    WHERE model_id = ${model.id} AND missing_at IS NULL
    ORDER BY filename`)

  // The same order as the model page's file list, so a shared model reads the
  // way its owner sees it: printable 3MFs first, then STLs, then the rest.
  const ordered = [...files.rows].sort(compareFiles)

  const totalSize = files.rows.reduce((sum, file) => sum + Number(file.size), 0)
  const hero = files.rows
    .filter((file) => file.thumb_state === 'ok')
    .sort(
      (a, b) =>
        Number(b.category === 'image') - Number(a.category === 'image') ||
        Number(b.size) - Number(a.size),
    )[0]

  const VIEWABLE = new Set(['stl', '3mf', 'obj', 'ply'])
  const viewable = files.rows
    .filter((file) => VIEWABLE.has(file.extension.toLowerCase()))
    .sort((a, b) => Number(b.size) - Number(a.size))[0]

  return (
    <main className="mx-auto max-w-4xl px-5 py-10 sm:px-8">
      <PageHeader
        eyebrow={`Shared from ${siteName}`}
        title={model.name}
        description={model.creatorName ? `by ${model.creatorName}` : undefined}
      >
        {model.notes && <p className="mt-2 max-w-2xl">{model.notes}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge tone="neutral">
            <FileStack className="size-3" />
            {files.rows.length} files · {formatBytes(totalSize)}
          </Badge>
          {model.license && <Badge tone="neutral">{model.license}</Badge>}
        </div>
      </PageHeader>

      <ShareViewer
        token={token}
        fileId={viewable?.id ?? null}
        format={(viewable?.extension.toLowerCase() ?? 'stl') as 'stl' | '3mf' | 'obj' | 'ply'}
        fileSize={Number(viewable?.size ?? 0)}
        filename={viewable?.filename ?? ''}
        thumbnailFileId={hero?.id ?? null}
        thumbnailKey={hero?.thumb_key ?? null}
      />

      <section className="mt-6">
        <SectionHeader title="Files" icon={<Box />} />
        <Card className="overflow-hidden">
          <ul className="divide-y divide-[var(--color-border)]">
            {ordered.map((file) => (
              <li key={file.id} className="flex items-center gap-3 px-4 py-2.5">
                <Badge className="min-w-12 shrink-0 justify-center uppercase">
                  {file.extension || 'Unknown'}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-sm">{file.filename}</span>
                <span className="shrink-0 text-xs tabular-nums text-[var(--color-ink-muted)]">
                  {formatBytes(Number(file.size))}
                </span>
                {/*
                 * The token travels with the request: this page is anonymous,
                 * so there is no session for the file route to check.
                 */}
                <Button asChild variant="ghost" size="sm" className="shrink-0">
                  {/* Icon only on a phone, so the file name keeps the width. */}
                  <a
                    href={`/api/share/${token}/files/${file.id}`}
                    aria-label={`Download ${file.filename}`}
                  >
                    <Download />
                    <span className="hidden sm:inline">Download</span>
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <footer className="mt-8 text-xs text-[var(--color-ink-faint)]">
        <p>This link shows one model. Whoever shared it can revoke the link at any time.</p>
      </footer>
    </main>
  )
}
