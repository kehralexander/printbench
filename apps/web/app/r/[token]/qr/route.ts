import QRCode from 'qrcode'

export const dynamic = 'force-dynamic'

/**
 * The status link as a QR code, to scan off the screen or print on a note.
 *
 * Only encodes the link itself, so it is as public as the link: no lookup,
 * and a token that names nothing simply makes a code for a page that 404s.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params
  if (!/^[0-9A-Za-z]{8,32}$/.test(token)) return new Response('Not found', { status: 404 })

  const base =
    process.env.BETTER_AUTH_URL?.trim().replace(/\/+$/, '') ||
    process.env.APP_URL?.trim().replace(/\/+$/, '') ||
    new URL(request.url).origin
  const svg = await QRCode.toString(`${base}/r/${token}`, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
  })
  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml',
      'cache-control': 'public, max-age=86400',
    },
  })
}
