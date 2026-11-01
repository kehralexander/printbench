ALTER TABLE "print_requests" ADD COLUMN IF NOT EXISTS "color_name" text;--> statement-breakpoint
ALTER TABLE "print_requests" ADD COLUMN IF NOT EXISTS "estimated_min" integer;--> statement-breakpoint
ALTER TABLE "print_requests" ADD COLUMN IF NOT EXISTS "started_at" timestamp with time zone;