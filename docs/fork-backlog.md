# Fork backlog

Next improvements requested for the fork (branch `oidc`), after the printer job
tracking release (`v0.7.4-oidc.6`). Not started yet.

## Building on job tracking

- [ ] **Printer jobs not in the library.** Jobs whose file matches nothing in
      PrintBench (started from the printer screen, sent straight from the
      slicer) are kept in `printer_jobs` with no model. List them and offer "add
      to the library" or "link to a model" per job, so the history gets
      complete (linking should create the print run retroactively).
- [ ] **Success-rate stats.** Cancelled/failed jobs land in the history with
      their percentage (note "Cancelled on … at 40%"; `printer_jobs.progress`).
      Show per model, file and material how often prints fail and at what point
      ("usually fails around 15%" → first layer / adhesion).
- [ ] **Ask how it went.** When a print finishes, show an "Unrated print"
      prompt to rate it and optionally add a photo. The history entry already
      exists, so it is one click.

## Building on Spoolman and the filament slots

- [ ] **"Load next" hint.** When a printer is idle, suggest the next queued
      request whose filament is already loaded, or say which spool to swap in
      for the most urgent one (uses `loadedFilament` + printer snapshots).
- [ ] **Spool burn-down forecast.** Sum the grams of the open queue per
      Spoolman spool and warn when the queue as a whole empties a spool ("Spool
      #17 runs out after 2 of the 4 queued prints"). Today's warning only looks
      at one request at a time.

## Queue quality-of-life

- [ ] **Drag to reorder the queue.** Order is priority, due date and age only.
      Add a manual position; it should also decide which request the tracker
      picks when a print starts (`attachRequest` ordering).
- [ ] **A short link for requesters.** A link or QR code for viewers: "your
      request is printing, 45% done, ready around 16:20", accurate from the
      tracker without anyone updating it by hand.

## Dashboard

- [ ] **Brief printer status on the dashboard.** A compact card per printer:
      idle or busy, and when busy the file, percentage and "done around" time,
      linking to the full status page. Read from the worker's snapshots
      (`printerSnapshots`), so the dashboard never waits on a printer.
