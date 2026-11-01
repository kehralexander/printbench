import { Readable } from 'node:stream'
import { getPreviewStore, requestThumbKeyByToken } from '@pb/core'
import { getDb } from '@pb/db'

export const dynamic = 'force-dynamic'

/**
 * The requested model's thumbnail, for the status page's visitor with no
 * account. The token is checked against this exact file, so the link reaches
 * that one model's previews and nothing else in the library.
 *
 * Every refusal is a 404, as with shared models.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; fileId: string }> },
): Promise<Response> {
  const { token, fileId } = await params
  const thumbKey = await requestThumbKeyByToken(getDb(), token, fileId)
  if (!thumbKey) return new Response('Not found', { status: 404 })

  const store = getPreviewStore()
  // Content-addressed, so these bytes never change and can be cached hard.
  const headers = {
    'content-type': 'image/webp',
    'cache-control': 'public, max-age=31536000, immutable',
    'x-robots-tag': 'noindex',
  }

  if (process.env.FILE_DELIVERY === 'xaccel') {
    return new Response(null, {
      status: 200,
      headers: { ...headers, 'x-accel-redirect': store.internalPath(thumbKey) },
    })
  }

  const data = await store.read(thumbKey)
  if (!data) return new Response('Not found', { status: 404 })
  return new Response(Readable.toWeb(Readable.from(data)) as ReadableStream, { headers })
}
