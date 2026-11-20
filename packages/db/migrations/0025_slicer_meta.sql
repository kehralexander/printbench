ALTER TABLE "model_files" ADD COLUMN "slicer_meta" jsonb;--> statement-breakpoint
ALTER TABLE "model_files" ADD COLUMN "slicer_meta_version" integer;--> statement-breakpoint
ALTER TABLE "model_files" ADD COLUMN "slicer_meta_error" text;