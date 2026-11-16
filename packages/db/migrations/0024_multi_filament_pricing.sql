CREATE TYPE "public"."payment_method" AS ENUM('cash', 'transfer', 'paypal', 'other');--> statement-breakpoint
CREATE TYPE "public"."price_status" AS ENUM('none', 'quoted', 'accepted', 'declined', 'invoiced', 'paid', 'waived');--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"contact" text,
	"default_tier" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer NOT NULL,
	"customer_id" uuid,
	"recipient" text,
	"request_ids" uuid[] NOT NULL,
	"lines" jsonb NOT NULL,
	"total" numeric(10, 2) NOT NULL,
	"tax_mode" text NOT NULL,
	"tax_rate" numeric(5, 2),
	"currency" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "invoices_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "print_request_filaments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"position" smallint DEFAULT 0 NOT NULL,
	"tool" smallint,
	"material" text,
	"color_hex" text,
	"color_name" text,
	"spoolman_spool_id" integer,
	"spool_id" uuid,
	"grams" numeric(10, 2)
);
--> statement-breakpoint
CREATE TABLE "request_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"method" "payment_method" DEFAULT 'cash' NOT NULL,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "print_hosts" ADD COLUMN "watts" integer;--> statement-breakpoint
ALTER TABLE "print_hosts" ADD COLUMN "hourly_rate" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "print_requests" ADD COLUMN "pricing_tier" text;--> statement-breakpoint
ALTER TABLE "print_requests" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "print_requests" ADD COLUMN "price_status" "price_status" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "print_requests" ADD COLUMN "quoted_price" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "print_requests" ADD COLUMN "quoted_cost" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "print_requests" ADD COLUMN "quote_breakdown" jsonb;--> statement-breakpoint
ALTER TABLE "print_requests" ADD COLUMN "quoted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "print_requests" ADD COLUMN "quote_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "print_requests" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "print_requests" ADD COLUMN "declined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "print_requests" ADD COLUMN "price_manual" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "print_requests" ADD COLUMN "needs_requote" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "print_requests" ADD COLUMN "invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_request_filaments" ADD CONSTRAINT "print_request_filaments_request_id_print_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."print_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_request_filaments" ADD CONSTRAINT "print_request_filaments_spool_id_filament_spools_id_fk" FOREIGN KEY ("spool_id") REFERENCES "public"."filament_spools"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_payments" ADD CONSTRAINT "request_payments_request_id_print_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."print_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_payments" ADD CONSTRAINT "request_payments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_name_idx" ON "customers" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "print_request_filaments_tool_idx" ON "print_request_filaments" USING btree ("request_id","tool");--> statement-breakpoint
CREATE INDEX "print_request_filaments_request_idx" ON "print_request_filaments" USING btree ("request_id","position");--> statement-breakpoint
CREATE INDEX "request_payments_request_idx" ON "request_payments" USING btree ("request_id","paid_at");--> statement-breakpoint
ALTER TABLE "print_requests" ADD CONSTRAINT "print_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_requests" ADD CONSTRAINT "print_requests_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "print_requests_customer_idx" ON "print_requests" USING btree ("customer_id") WHERE "print_requests"."customer_id" IS NOT NULL;--> statement-breakpoint
-- Each request's one filament becomes a list of one. Requests that named
-- nothing get no row: an empty list is "any filament", as the nulls were.
-- Tool 0 only once there is a file to number it.
INSERT INTO "print_request_filaments" ("request_id", "position", "tool", "material", "color_hex", "color_name", "spoolman_spool_id", "grams")
SELECT "id", 0, CASE WHEN "model_file_id" IS NOT NULL THEN 0 END, "material", "color_hex", "color_name", "spoolman_spool_id", "filament_g"
FROM "print_requests"
WHERE "material" IS NOT NULL OR "color_hex" IS NOT NULL OR "color_name" IS NOT NULL
   OR "spoolman_spool_id" IS NOT NULL OR "filament_g" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "print_requests" DROP COLUMN "material";--> statement-breakpoint
ALTER TABLE "print_requests" DROP COLUMN "color_hex";--> statement-breakpoint
ALTER TABLE "print_requests" DROP COLUMN "color_name";--> statement-breakpoint
ALTER TABLE "print_requests" DROP COLUMN "spoolman_spool_id";--> statement-breakpoint
ALTER TABLE "print_requests" DROP COLUMN "filament_g";