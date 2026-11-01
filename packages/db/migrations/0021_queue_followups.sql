ALTER TABLE "print_runs" ADD COLUMN IF NOT EXISTS "review_dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "printer_jobs" ADD COLUMN IF NOT EXISTS "dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "print_requests" ADD COLUMN IF NOT EXISTS "position" integer;--> statement-breakpoint
ALTER TABLE "print_requests" ADD COLUMN IF NOT EXISTS "share_token" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "print_requests_share_token_idx" ON "print_requests" USING btree ("share_token") WHERE "print_requests"."share_token" IS NOT NULL;