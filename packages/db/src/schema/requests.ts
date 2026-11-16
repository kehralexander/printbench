import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { paymentMethod, printRequestPriority, printRequestStatus, priceStatus } from './enums'
import { user } from './auth'
import { filamentSpools } from './filaments'
import { modelFiles, models } from './models'
import { printRuns } from './prints'

/**
 * People who are charged for prints, when they are charged often enough to be
 * worth naming. `requestedBy` stays free text for the one-off asker; a
 * customer is what stops "Tom" and "tom" being two balances.
 */
export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** Email, phone, wherever the invoice goes. Free text. */
    contact: text('contact'),
    /** A pricing tier key from the `pricing` setting; null uses the instance default. */
    defaultTier: text('default_tier'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('customers_name_idx').on(sql`lower(${t.name})`)],
)

/**
 * Invoices and receipts, numbered from a gap-free sequence.
 *
 * The lines are a snapshot: an invoice says what was charged on the day it
 * was written, whatever happens to the requests behind it afterwards. Never
 * deleted, so the numbering stays without holes.
 */
export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  number: integer('number').notNull().unique(),
  customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  /** Who it is addressed to, as printed. */
  recipient: text('recipient'),
  requestIds: uuid('request_ids').array().notNull(),
  lines: jsonb('lines').$type<InvoiceLine[]>().notNull(),
  total: numeric('total', { precision: 10, scale: 2 }).notNull(),
  /** The tax treatment printed on it, frozen with the lines. */
  taxMode: text('tax_mode').notNull(),
  taxRate: numeric('tax_rate', { precision: 5, scale: 2 }),
  currency: text('currency').notNull(),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
})

export interface InvoiceLine {
  requestId: string
  title: string
  quantity: number
  unitPrice: number
  total: number
}

/**
 * The print queue — things people have asked to have printed.
 *
 * Shared across the instance rather than per-user, unlike lists. A request is
 * addressed *to* whoever runs the printer, so a queue only one person can see
 * is the wrong shape: the housemate raises it, the owner works through it.
 *
 * `title` is free text and is the only required field, because the request
 * usually arrives before the file does — "something to hold the kitchen roll"
 * is a legitimate queue entry. `modelId` is the link to the library when one
 * exists, and stays null when it does not.
 */
export const printRequests = pgTable(
  'print_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** What was asked for, in the asker's words. */
    title: text('title').notNull(),
    notes: text('notes'),

    /**
     * Who asked, as free text. Most people who ask for a print do not have an
     * account here, so this is not a foreign key. `requestedByUserId` is set
     * as well when the asker did sign in and raise it themselves.
     */
    requestedBy: text('requested_by'),
    requestedByUserId: text('requested_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),

    /**
     * The library link. `set null` rather than cascade: if the model is
     * removed the request is still outstanding, it just has nothing to point
     * at any more.
     */
    modelId: uuid('model_id').references(() => models.id, { onDelete: 'set null' }),
    /** The specific file to print, when the model has more than one. */
    modelFileId: uuid('model_file_id').references(() => modelFiles.id, { onDelete: 'set null' }),

    quantity: integer('quantity').notNull().default(1),
    priority: printRequestPriority('priority').notNull().default('normal'),
    status: printRequestStatus('status').notNull().default('requested'),

    /**
     * Expected printing time for ONE print, in minutes; the queue multiplies by
     * quantity. Typed in, or pre-filled from the slicer's estimate in a linked
     * G-code file or from earlier prints of the model — never recomputed over
     * a value someone entered.
     */
    estimatedMin: integer('estimated_min'),
    /** When it went on the printer. Gives "done around" and a real duration. */
    startedAt: timestamp('started_at', { withTimezone: true }),

    /*
     * Pricing. The quote is frozen once given: `quotedPrice` changes only when
     * someone quotes again, and anything that would change the price after
     * that raises `needsRequote` instead of moving the number under a
     * requester who already agreed to it.
     */
    /** Tier key from the `pricing` setting; null falls back to the customer's, then the default. */
    pricingTier: text('pricing_tier'),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    priceStatus: priceStatus('price_status').notNull().default('none'),
    quotedPrice: numeric('quoted_price', { precision: 10, scale: 2 }),
    /** What it was expected to cost to make, when quoted. Admin side only. */
    quotedCost: numeric('quoted_cost', { precision: 10, scale: 2 }),
    /** The rough split shown with the quote: material, time, handling. */
    quoteBreakdown: jsonb('quote_breakdown').$type<{ label: string; amount: number }[]>(),
    quotedAt: timestamp('quoted_at', { withTimezone: true }),
    quoteExpiresAt: timestamp('quote_expires_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    declinedAt: timestamp('declined_at', { withTimezone: true }),
    /** A typed price, never recomputed — like `print_runs.filament_cost_manual`. */
    priceManual: boolean('price_manual').notNull().default(false),
    /** The file, quantity, colours or tier changed after the quote. */
    needsRequote: boolean('needs_requote').notNull().default(false),
    invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),

    /** Prints finished so far, towards `quantity`, as counted from the printer. */
    printsDone: integer('prints_done').notNull().default(0),
    /** The printer job it is on right now, while one is. */
    printerJobId: uuid('printer_job_id'),
    /**
     * A manual place in the queue, set by dragging. Lower comes first; null
     * falls back to priority, due date and age after the placed ones.
     */
    position: integer('position'),
    /** The short link a requester can follow to see how it is going. */
    shareToken: text('share_token'),

    /**
     * The print history entry created when this was marked printed.
     *
     * Kept so the entry can be withdrawn again if the request is reopened.
     * `set null` because deleting the run by hand from the model page is
     * legitimate and should not take the request with it.
     */
    printRunId: uuid('print_run_id').references(() => printRuns.id, { onDelete: 'set null' }),

    dueAt: timestamp('due_at', { withTimezone: true }),
    /** Set when the request reaches `done` or `cancelled`. */
    closedAt: timestamp('closed_at', { withTimezone: true }),

    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The queue view: open requests, most urgent first. Descending on priority
    // because the enum sorts low -> high and the urgent end is the one read.
    index('print_requests_status_idx').on(t.status, t.priority.desc(), t.dueAt),
    // "What is queued for this model", shown on the model page. Partial: most
    // requests never name a model, and those rows are never looked up this way.
    index('print_requests_model_idx')
      .on(t.modelId)
      .where(sql`${t.modelId} IS NOT NULL`),
    index('print_requests_creator_idx').on(t.createdBy),
    index('print_requests_customer_idx')
      .on(t.customerId)
      .where(sql`${t.customerId} IS NOT NULL`),
    uniqueIndex('print_requests_share_token_idx')
      .on(t.shareToken)
      .where(sql`${t.shareToken} IS NOT NULL`),
    // Only ever looked up from a request that has one, and most never will.
    index('print_requests_print_run_idx')
      .on(t.printRunId)
      .where(sql`${t.printRunId} IS NOT NULL`),
  ],
)

/**
 * The filaments a request prints in, one row per G-code tool.
 *
 * A single-filament request is a list of one, so nothing needs two code paths.
 * Before a file is linked the rows are wishes ("in red PLA") with no tool; a
 * linked G-code numbers them and fills in the grams.
 */
export const printRequestFilaments = pgTable(
  'print_request_filaments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => printRequests.id, { onDelete: 'cascade' }),
    /** Display order; the tool order once there is a file. */
    position: smallint('position').notNull().default(0),
    /** G-code tool number, T0 = 0. Null while the request has no file. */
    tool: smallint('tool'),
    material: text('material'),
    colorHex: text('color_hex'),
    /** "Galaxy Black" — the hex alone renders a dot but reads as nothing. */
    colorName: text('color_name'),
    /**
     * The Spoolman spool chosen, when Spoolman is the inventory. A soft
     * reference into another system: no foreign key.
     */
    spoolmanSpoolId: integer('spoolman_spool_id'),
    /**
     * PrintBench's own spool, when it is the inventory. What lets a finished
     * print record its usage per spool.
     */
    spoolId: uuid('spool_id').references(() => filamentSpools.id, { onDelete: 'set null' }),
    /** Grams for ONE print, from the slicer's per-tool figures. */
    grams: numeric('grams', { precision: 10, scale: 2 }),
  },
  (t) => [
    uniqueIndex('print_request_filaments_tool_idx').on(t.requestId, t.tool),
    index('print_request_filaments_request_idx').on(t.requestId, t.position),
  ],
)

/** Money received against a request. Several rows cover deposits and part payments. */
export const requestPayments = pgTable(
  'request_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => printRequests.id, { onDelete: 'cascade' }),
    amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
    method: paymentMethod('method').notNull().default('cash'),
    paidAt: timestamp('paid_at', { withTimezone: true }).notNull().defaultNow(),
    note: text('note'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('request_payments_request_idx').on(t.requestId, t.paidAt)],
)
