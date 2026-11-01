import { getSessionUser } from '@pb/auth'
import {
  MAX_PHOTO_BYTES,
  ReviewError,
  can,
  readPrintPhoto,
  recordAudit,
  setPrintPhoto,
} from '@pb/core'
import { getDb } from '@pb/db'

export const dynamic = 'force-dynamic'

/**
 * A print's photo: GET shows it to anyone who can see the library, POST
 * (multipart, field `photo`) sets or replaces it for whoever may log prints.
 *
 * A route rather than a server action because a phone photo is well past the
 * one-megabyte limit server actions have.
 */
function validId(printId: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(printId)
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ printId: string }> },
): Promise<Response> {
  const user = await getSessionUser()
  if (!can({ id: user?.id ?? '', role: user?.role ?? null }, 'model:view')) {
    return new Response('Not permitted', { status: 403 })
  }
  const { printId } = await params
  if (!validId(printId)) return new Response('Not found', { status: 404 })
  const photo = await readPrintPhoto(getDb(), printId)
  if (!photo) return new Response('No photo', { status: 404 })
  return new Response(new Uint8Array(photo.data), {
    headers: {
      'content-type': photo.contentType,
      'cache-control': 'private, max-age=300',
      'x-content-type-options': 'nosniff',
    },
  })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ printId: string }> },
): Promise<Response> {
  const user = await getSessionUser()
  if (
    !user ||
    !can({ id: user.id, role: user.role ?? null, banned: user.banned ?? false }, 'print:log')
  ) {
    return Response.json({ ok: false, error: 'Not permitted.' }, { status: 403 })
  }
  const { printId } = await params
  if (!validId(printId)) return Response.json({ ok: false, error: 'Not found.' }, { status: 404 })

  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > MAX_PHOTO_BYTES + 64 * 1024) {
    return Response.json(
      { ok: false, error: 'That photo is too large (15 MB at most).' },
      { status: 413 },
    )
  }
  try {
    const form = await request.formData()
    const file = form.get('photo')
    if (!(file instanceof Blob)) {
      return Response.json({ ok: false, error: 'Choose a photo.' }, { status: 400 })
    }
    await setPrintPhoto(getDb(), printId, Buffer.from(await file.arrayBuffer()))
    await recordAudit(getDb(), {
      action: 'print.updated',
      actor: { type: 'user', id: user.id, name: user.name },
      target: { type: 'print', id: printId },
      detail: { photo: true },
    })
    return Response.json({ ok: true })
  } catch (error) {
    if (error instanceof ReviewError) {
      return Response.json({ ok: false, error: error.message }, { status: 400 })
    }
    console.error('[print-photo]', error)
    return Response.json({ ok: false, error: 'Could not save that photo.' }, { status: 500 })
  }
}
