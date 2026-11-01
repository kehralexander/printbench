import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Downloads a single file.
 *
 * A plain link, not a fetch: the browser then owns the transfer, so progress,
 * pause and resume work, and a multi-gigabyte mesh never passes through
 * JavaScript memory. The endpoint sets Content-Disposition, so no `download`
 * attribute is needed — and relying on one would break for cross-origin
 * deployments.
 */
export function FileDownloadLink({ fileId, filename }: { fileId: string; filename: string }) {
  // The same ghost icon button as every other row action.
  return (
    <Button asChild variant="ghost" size="icon" className="shrink-0">
      <a
        href={`/api/files/${fileId}/raw`}
        title={`Download ${filename}`}
        aria-label={`Download ${filename}`}
      >
        <Download />
      </a>
    </Button>
  )
}
