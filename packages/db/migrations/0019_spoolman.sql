ALTER TABLE "print_requests" ADD COLUMN IF NOT EXISTS "spoolman_spool_id" integer;--> statement-breakpoint
ALTER TABLE "print_requests" ADD COLUMN IF NOT EXISTS "filament_g" integer;