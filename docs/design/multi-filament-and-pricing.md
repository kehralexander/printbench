# Multi-filament requests and pricing

Design notes for two queue features: requests that print in more than one
filament, and a price on each request that can be charged to whoever asked
for it. Both are implemented; see [Implementation](#implementation) at the end
for where each part lives and where the build differs from the plan.

"Where things stand" below describes the code before this work.

## Where things stand

**Multi-filament.** Sending already works on KX-Bridge (Anycubic ACE).
`gcodePaints` and `planSlots` in `packages/core/src/services/kx-bridge.ts`
read every tool the G-code uses and match each one to a loaded slot, or ask
when the match is not certain. Everything else assumes one filament per
request:

- `print_requests` has one `material`, `colorHex`, `colorName`,
  `spoolmanSpoolId` and `filamentG`.
- `gcode-metadata.ts` keeps the first value of each per-extruder list
  (`firstOf`) and only sets `multiMaterial`.
- `loadedFilament` and `queue-planning.ts` check one filament, so a
  two-colour request reads as ready when only one colour is loaded.
- `spoolForecast` charges the whole `filamentG` to one spool.
- `planSlots` only uses the request's filament when the file has one tool.
- Other print hosts upload the file without assigning filament slots, so the
  printer's firmware has to handle the tool changes.

**Pricing.** Some of what pricing needs is already stored:

- `filament_spools.purchaseCost` and `nominalWeightG` give a cost per gram.
- `print_filament_usage` already records usage across several spools per print
  run, each with its `costPerGram` at the time of the print.
- `print_runs.filamentCost` / `filamentCostManual` set the pattern for a value
  that is worked out once and never overwritten when set by hand.
- `settings` is a key/value jsonb table for instance-wide values.
- `/r/[token]` is a per-request status page for requesters without an account.
- `print_runs` statuses give a success rate per model and printer.

Spoolman has `spool.price` and `filament.price`, but `toSpool` in
`packages/core/src/spoolman/spoolman.ts` does not read them yet.

---

## Part 1: Multi-filament requests

### Data model

A child table, not array columns:

```ts
// packages/db/src/schema/requests.ts
export const printRequestFilaments = pgTable(
  'print_request_filaments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => printRequests.id, { onDelete: 'cascade' }),
    /** G-code tool number, T0 = 0. Null while the request has no file. */
    tool: smallint('tool'),
    material: text('material'),
    colorHex: text('color_hex'),
    colorName: text('color_name'),
    spoolmanSpoolId: integer('spoolman_spool_id'),
    /** Grams for ONE print, from the slicer's per-tool figures. */
    grams: numeric('grams', { precision: 10, scale: 2 }),
  },
  (t) => [uniqueIndex('print_request_filaments_tool_idx').on(t.requestId, t.tool)],
)
```

Migration: copy each request's `material`, `colorHex`, `colorName`,
`spoolmanSpoolId` and `filamentG` into one row with `tool = 0`, then drop the
columns. A single-filament request is a list of one, so nothing needs two code
paths.

### Reading per-tool data from G-code

- `gcode-metadata.ts` returns `filaments: { tool, material, colorHex, grams }[]`
  instead of the first value plus `multiMaterial`. PrusaSlicer and Orca write
  per-tool lists, e.g. `filament used [g] = 12.3, 4.5`.
- Tool numbering and "is this tool used" move from `gcodePaints` into the
  slicer module, so the queue and the KX-Bridge send always agree on what T1
  is.
- Finding the used tools means scanning the whole file for `T<n>`. Do it once
  when a file is linked to a request, not on every page render.

### Logic

| Where               | Now                                              | After                                                           |
| ------------------- | ------------------------------------------------ | --------------------------------------------------------------- |
| `loadedFilament`    | Is the one filament loaded?                      | Is every filament loaded on one printer? Returns those missing. |
| `queue-planning.ts` | Ready when the head request's filament is loaded | Ready only when all of its filaments are                        |
| `spoolForecast`     | Whole `filamentG` charged to one spool           | Grams summed per spool across all rows                          |
| `planSlots`         | Request filament only used for single-tool files | Each tool uses its row's spool, else its colour and material    |
| Print run on finish | One `material` / `colorHex`                      | One `print_filament_usage` row per filament                     |

### UI

- The request editor and add form show filament rows (material, colour,
  spool), filled in from the G-code when a file is linked. A single-filament
  request looks the same as today.
- Queue rows show one swatch per filament. The "not loaded" badge names the
  colour that is missing.
- `/r/[token]` shows every colour.

---

## Part 2: Pricing

The price is meant to be charged to other people, so it is a quote that gets
agreed and paid, not just a calculated number.

### Cost and price

**Cost** is what a print costs you. It stays on the admin side.
**Price** is what the requester is charged. Only the price is shown on
`/r/[token]`; a setting can also show a rough split
(material / time / handling).

A pure function in `packages/core/src/services/pricing.ts`, tested like
`queue-planning`:

```ts
quotePrint(
  input: {
    filaments: { grams: number; costPerGram: number | null; material: string | null }[]
    printMin: number | null
    quantity: number
    printer: { watts: number | null; hourlyRate: number | null } | null
    /** From print history; falls back to the settings default. */
    successRate?: number
  },
  rates: PricingSettings,
  tier: PricingTier,
): {
  costLines: { label: string; amount: number }[]
  cost: number
  unitPrice: number
  price: number
  /** What could not be priced, e.g. "no price for spool 12". */
  incomplete: string[]
}
```

### Cost per print

1. **Material.** Grams × cost per gram for each filament. Cost per gram
   comes from, in order: the local spool (`purchaseCost` / weight), then
   Spoolman (`spool.price ?? filament.price` / weight), then the per-material
   default in settings. Slicer totals already include purge and prime tower.
2. **Electricity.** Hours × the printer's average watts × the price per kWh.
3. **Machine time.** Hours × the printer's hourly rate (wear, nozzles, build
   plates, depreciation).
4. **Failure allowance.** Divided by the success rate, from `print_runs`
   for the model or printer when there is enough history, else the default.

### From cost to price

```
unit  = (material + electricity + machine) / successRate
price = round(max(minimum, (unit × quantity + handlingFee) × (1 + markup)))
```

The handling fee is charged once per request, not per copy (setup, support
removal, packing). The minimum stops a 4 g keychain coming to €0.30.

### Rate tiers

People are not all charged the same. Tiers live in settings; each request has
one, defaulting to the customer's tier or the instance default:

```ts
tiers: [
  { key: 'cost', label: 'At cost', markupPercent: 0, handlingFee: 0 },
  { key: 'friend', label: 'Friends', markupPercent: 10, handlingFee: 1 },
  { key: 'public', label: 'Standard', markupPercent: 50, handlingFee: 3, minimum: 5 },
]
```

### Quote lifecycle

`priceStatus` is a separate enum from `status`, so printing and payment are
tracked independently:

```
none → quoted → accepted | declined → invoiced → paid
                                     ↘ waived
```

- **Locking.** On acceptance `quotedPrice` is frozen. Changing the file,
  quantity, colours or tier afterwards marks the request "needs requote"
  instead of changing the price silently.
- **Accepting.** Accept / Decline buttons on `/r/[token]`; the time is
  recorded. Optionally, a quoted request is held back from "next up" until it
  is accepted.
- **Expiry.** Quotes are valid for N days (a setting), because filament prices
  change.
- **Manual price.** `priceManual` works like `filamentCostManual`: a typed
  price is never recomputed.

### Failed prints

The customer pays the agreed price, not per attempt. Reprints come out of the
failure allowance. Comparing actual cost (real duration and grams from the
print run) against the quoted cost shows whether the allowance is right.

### Payments and customers

- `request_payments`: `{ requestId, amount, method, paidAt, note }`. Method is
  `cash | transfer | paypal | other`. Supports deposits and partial payments.
- `customers`: `{ name, contact, defaultTier, notes }`, optionally linked from
  requests. `requestedBy` stays free text for one-off askers. This stops
  "Tom" and "tom" being two people when adding up balances.
- A "who owes what" view: open balance per customer, with the requests behind
  it.
- Optionally require a deposit before printing, above a price threshold.

### Receipts and invoices

- A PDF per request, or per customer for several requests: number, date,
  items, quantity, unit price, total, amount paid, balance.
- Numbers from a gap-free sequence in the database.
- Settings for the seller's name and address, and a payment note (PayPal
  link, IBAN).

### Tax

Charging regularly may count as a trade. Under the German small-business rule
(§19 UStG, _Kleinunternehmerregelung_) an invoice has to say that no VAT is
charged; otherwise it has to show VAT. The code does not decide which rule
applies. It has a `taxMode` setting (`none | small-business-note | vat`) and a
rate. Which mode applies is a question for a tax adviser.

### Storage summary

| Where                    | What                                                                                                                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `settings` key `pricing` | `currency`, `kwhPrice`, `defaultPerKg` by material, `defaultSuccessRate`, `tiers`, `defaultTier`, `roundTo`, `quoteValidDays`, `showBreakdownToRequester`, seller details, `taxMode`, `taxRate` |
| `print_hosts`            | `watts`, `hourlyRate`                                                                                                                                                                           |
| `print_requests`         | `pricingTier`, `customerId`, `quotedPrice`, `quotedCost`, `quotedAt`, `quoteExpiresAt`, `acceptedAt`, `priceStatus`, `priceManual`                                                              |
| new `request_payments`   | payments against a request                                                                                                                                                                      |
| new `customers`          | optional named requesters with a default tier                                                                                                                                                   |
| `toSpool` (Spoolman)     | read `spool.price` / `filament.price`                                                                                                                                                           |

### Where it shows

- Price tag on queue rows; cost breakdown and override in the request editor.
- "≈ €3.20 to print" on the model page when there is a G-code file.
- Price, quote status and Accept / Decline on `/r/[token]`.
- Balances per customer.
- A pricing section in the admin settings.

---

## Order of work

1. `pricing.ts` (cost, tiers, minimum, rounding), the `pricing` setting,
   printer rates, Spoolman prices.
2. Quote fields and lifecycle on requests; Accept / Decline on `/r/[token]`.
3. Payments, customers, balances.
4. Receipts and invoices, tax mode.
5. Multi-filament (Part 1): per-tool parsing and the new table, then
   loaded / planning / forecast / slot mapping, then the UI.

Part 1 does not depend on Part 2 and can run alongside it. Until it lands,
pricing treats a request's single `filamentG` as one filament row. Steps 1–2
are useful on their own; 3–4 matter once money changes hands.

---

## Implementation

Migration `0024_multi_filament_pricing` adds everything in the storage tables
above. It copies each request's single filament into one
`print_request_filaments` row (tool 0 when the request has a file, else no
tool) and then drops the old columns.

**Part 1**

- `slicer/gcode-tools.ts` numbers tools and decides which are used, for the
  queue, `gcode-metadata.ts` (`filaments`) and the KX-Bridge send
  (`gcodePaints`) alike. `readGcodeWithTools` scans the whole file for `T<n>`.
  It runs only when a file is linked to a request (`createRequest`,
  `linkRequest`, and the editor's file picker).
- `services/request-filaments.ts` is client-safe. It has row validation and
  `mergeFilaments`, which carries what was asked for over to the file's tools.
- `loadedFilament`, `loadNextHints`, `spoolForecast` and `planSlots` work on
  the rows, as in the table above.
- Marking a request printed, and the printer tracker, write one
  `print_filament_usage` row per filament on a local spool.

**Part 2**

- `services/pricing.ts` is pure and client-safe (`@pb/core/pricing`). It
  holds `quotePrint`, the `pricing` setting with its validation, tiers,
  deposits and rounding.
- `services/billing-service.ts` handles the rest: cost-per-gram resolution,
  printer rates, the success rate from history, quotes and their lifecycle,
  payments, customers and balances, gap-free invoices, the PDF, actual cost,
  and the model-page estimate.
- `services/pdf.ts` is a small built-in writer for the receipt (Helvetica,
  WinAnsi), so no PDF library is needed.
- The UI covers:
  - filament rows and a price panel in the queue editor
  - swatches, price tags and held badges on queue rows
  - colours, price and Accept / Decline on `/r/[token]`
  - a Pricing section in admin settings
  - printer watts and rate
  - `/billing` (balances, customers, invoices)
  - `/billing/invoices/[id]/pdf`
  - "≈ €… to print" on the model page

**Where the build differs from the plan**

- `print_request_filaments` also has `position` and an optional local
  `spool_id`. `print_filament_usage` needs a local spool, so the usage can only
  be recorded per filament when one is picked. The picker offers local spools
  for that.
- `print_requests` also has `quote_breakdown`, `declined_at`, `needs_requote`
  and `invoice_id`. A new `invoices` table holds the frozen lines.
- In VAT mode the quoted price includes VAT.
- Partial prints count as half a success. Model history is used from 5
  runs and printer history from 10.
- A printer's own rates apply when the request is on it, or when it is the
  only printer that has rates. Otherwise the settings defaults are used.
- Invoice numbers are `max + 1` taken under an advisory lock inside the
  invoice transaction. Invoices are never deleted.
- Billing needs the new `billing:manage` permission (members). Viewers never
  see costs or quote controls.
