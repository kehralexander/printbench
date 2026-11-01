CREATE TABLE IF NOT EXISTS "printer_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"model_id" uuid,
	"model_file_id" uuid,
	"request_id" uuid,
	"print_run_id" uuid,
	"status" text DEFAULT 'printing' NOT NULL,
	"progress" numeric(5, 4),
	"print_sec" integer,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "printer_jobs_host_id_print_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."print_hosts"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
ALTER TABLE "print_hosts" ADD COLUMN IF NOT EXISTS "status" jsonb;--> statement-breakpoint
ALTER TABLE "print_hosts" ADD COLUMN IF NOT EXISTS "status_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "print_requests" ADD COLUMN IF NOT EXISTS "prints_done" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "print_requests" ADD COLUMN IF NOT EXISTS "printer_job_id" uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "printer_jobs_host_idx" ON "printer_jobs" USING btree ("host_id","started_at");
