import { getSessionUser } from '@pb/auth'
import { can, cents, getInvoice, getSettings, invoicePdf, listPayments } from '@pb/core'
import { getDb } from '@pb/db'

export const dynamic = 'force-dynamic'

/**
 * An invoice as a PDF, drawn fresh each time.
 *
 * Fresh because the amount paid is printed on it: an invoice opened again
 * after the money came in reads as a receipt. The seller's details come from
 * the current settings for the same reason; the lines and total do not change.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await getSessionUser()
  if (
    !user ||
    !can({ id: user.id, role: user.role ?? null, banned: user.banned ?? false }, 'billing:manage')
  ) {
    return new Response('Not permitted', { status: 403 })
  }

  const { id } = await params
  const db = getDb()
  const invoice = await getInvoice(db, id)
  if (!invoice) return new Response('Not found', { status: 404 })

  const [{ pricing }, payments] = await Promise.all([
    getSettings(db),
    listPayments(db, invoice.requestIds),
  ])
  const paid = payments.reduce((sum, payment) => sum + payment.amount, 0)
  const pdf = invoicePdf(invoice, pricing.seller, cents(paid))

  return new Response(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="invoice-${invoice.number}.pdf"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}
