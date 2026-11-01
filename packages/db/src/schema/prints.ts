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
  uuid,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { bedAdhesion, nozzleType, printHostProtocol, printStatus } from './enums'
import { user } from './auth'

/**
 * Print history — a log of actual prints against a model. Drives "printed 3x,
 * last on 12 Aug", the never-printed filter, and per-model success rates.
 */
export const printRuns = pgTable(
  'print_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    modelId: uuid('model_id').notNull(),
    /** Which file was actually printed, when known. */
    modelFileId: uuid('model_file_id'),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),

    printerName: text('printer_name'),
    material: text('material'),
    colorHex: text('color_hex'),
    layerHeightMm: numeric('layer_height_mm', { precision: 5, scale: 3 }),
    nozzleMm: numeric('nozzle_mm', { precision: 4, scale: 2 }),
    /* Diameter and material are separate questions; only one of them ruins a hot end. */
    nozzleType: nozzleType('nozzle_type'),

    /* Which spool, and what it cost. Cost is a bare number: a self-hosted
     * instance has one owner and therefore one currency. */
    filamentBrand: text('filament_brand'),
    colorName: text('color_name'),
    filamentCost: numeric('filament_cost', { precision: 10, scale: 2 }),
    filamentCostManual: boolean('filament_cost_manual').notNull().default(false),
    recordingKey: text('recording_key'),

    /* What the slicer was asked to do. Every one of these is nullable because
     * a print logged by hand legitimately does not know them, and a guessed
     * value is worse than an empty one. */
    infillPercent: smallint('infill_percent'),
    wallCount: smallint('wall_count'),
    /** Null is unknown; false is a deliberate "no supports". */
    supports: boolean('supports'),
    adhesion: bedAdhesion('adhesion'),
    nozzleTempC: smallint('nozzle_temp_c'),
    bedTempC: smallint('bed_temp_c'),
    slicerName: text('slicer_name'),
    slicerVersion: text('slicer_version'),
    /** The named profile inside the slicer, e.g. "0.20mm Standard @BBL X1C". */
    slicerProfile: text('slicer_profile'),

    status: printStatus('status').notNull().default('success'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationMin: integer('duration_min'),
    filamentUsedG: numeric('filament_used_g', { precision: 10, scale: 2 }),

    /** 1-5, the user's own verdict on how it came out. */
    rating: smallint('rating'),
    notes: text('notes'),
    photoKey: text('photo_key'),
    /** Set when someone waved off "how did it go?" for a print the printer logged. */
    reviewDismissedAt: timestamp('review_dismissed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('print_runs_model_idx').on(t.modelId, t.startedAt),
    index('print_runs_user_idx').on(t.userId),
    uniqueIndex('print_runs_recording_key_idx').on(t.recordingKey),
  ],
)

/** A networked printer we can push a sliced file to. */
export const printHosts = pgTable('print_hosts', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  protocol: printHostProtocol('protocol').notNull(),
  endpoint: text('endpoint').notNull(),
  /** Encrypted at rest by packages/core/crypto. */
  credentials: text('credentials'),
  lastSeenOk: timestamp('last_seen_ok', { withTimezone: true }),
  /**
   * The last status the worker read, and when. Lets the queue show live times
   * without waiting on a printer that may be switched off.
   */
  status: jsonb('status'),
  statusAt: timestamp('status_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Jobs seen on a printer, as the worker watched them start and end.
 *
 * Printers keep little or no history of their own, so this is what turns
 * "it was printing, now it is not" into a logged print and a queue request
 * moving along. The model, file, request and run are soft references: a job
 * outlives any of them being deleted, and simply stops linking.
 */
export const printerJobs = pgTable(
  'printer_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    hostId: uuid('host_id')
      .notNull()
      .references(() => printHosts.id, { onDelete: 'cascade' }),
    /** As the printer names it, directories included. */
    filename: text('filename').notNull(),
    modelId: uuid('model_id'),
    modelFileId: uuid('model_file_id'),
    requestId: uuid('request_id'),
    printRunId: uuid('print_run_id'),
    /** printing, success, cancelled or failed. */
    status: text('status').notNull().default('printing'),
    /** Last progress seen, 0–1. */
    progress: numeric('progress', { precision: 5, scale: 4 }),
    /** Seconds actually printing, as the printer counts them. */
    printSec: integer('print_sec'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** Set when an unmatched job was waved off rather than linked to a model. */
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('printer_jobs_host_idx').on(t.hostId, t.startedAt)],
)
