CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_logs_actor_type_check" CHECK (actor_type in ('user', 'integration', 'system')),
	CONSTRAINT "audit_logs_actor_check" CHECK ((actor_type = 'system') = (actor_id is null)),
	CONSTRAINT "audit_logs_action_check" CHECK (char_length(action) between 1 and 80),
	CONSTRAINT "audit_logs_entity_type_check" CHECK (char_length(entity_type) <= 40),
	CONSTRAINT "audit_logs_entity_id_check" CHECK (char_length(entity_id) <= 64),
	CONSTRAINT "audit_logs_metadata_check" CHECK (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 2048)
);
--> statement-breakpoint
CREATE TABLE "exam_types" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"name" "citext" NOT NULL,
	"kind" text NOT NULL,
	"duration_min" smallint NOT NULL,
	"preparation_notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_types_code_key" UNIQUE("code"),
	CONSTRAINT "exam_types_name_key" UNIQUE("name"),
	CONSTRAINT "exam_types_code_check" CHECK (code ~ '^[a-z][a-z0-9_]{1,39}$'),
	CONSTRAINT "exam_types_name_check" CHECK (char_length(name) between 2 and 80),
	CONSTRAINT "exam_types_kind_check" CHECK (kind in ('lab', 'imaging')),
	CONSTRAINT "exam_types_duration_min_check" CHECK (duration_min between 5 and 240 and duration_min % 5 = 0),
	CONSTRAINT "exam_types_preparation_notes_check" CHECK (char_length(preparation_notes) <= 1000)
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"appointment_late_window_hours" smallint DEFAULT 24 NOT NULL,
	"exam_late_window_hours" smallint DEFAULT 2 NOT NULL,
	"max_reschedules" smallint DEFAULT 2 NOT NULL,
	"booking_horizon_days" smallint DEFAULT 60 NOT NULL,
	"min_lead_minutes" integer DEFAULT 60 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_single_row_check" CHECK (id),
	CONSTRAINT "settings_appointment_late_window_hours_check" CHECK (appointment_late_window_hours between 0 and 168),
	CONSTRAINT "settings_exam_late_window_hours_check" CHECK (exam_late_window_hours between 0 and 168),
	CONSTRAINT "settings_max_reschedules_check" CHECK (max_reschedules between 0 and 10),
	CONSTRAINT "settings_booking_horizon_days_check" CHECK (booking_horizon_days between 1 and 365),
	CONSTRAINT "settings_min_lead_minutes_check" CHECK (min_lead_minutes between 0 and 10080)
);
--> statement-breakpoint
CREATE TABLE "specialties" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" "citext" NOT NULL,
	"council" text NOT NULL,
	"appointment_duration_min" smallint DEFAULT 30 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "specialties_name_key" UNIQUE("name"),
	CONSTRAINT "specialties_id_council_key" UNIQUE("id","council"),
	CONSTRAINT "specialties_name_check" CHECK (char_length(name) between 2 and 80),
	CONSTRAINT "specialties_council_check" CHECK (council ~ '^[A-Z]{3,10}$'),
	CONSTRAINT "specialties_appointment_duration_min_check" CHECK (appointment_duration_min between 10 and 240 and appointment_duration_min % 5 = 0)
);
--> statement-breakpoint
CREATE TABLE "unit_exam_offers" (
	"unit_id" uuid NOT NULL,
	"exam_type_id" uuid NOT NULL,
	"capacity_per_slot" smallint NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unit_exam_offers_pkey" PRIMARY KEY("unit_id","exam_type_id"),
	CONSTRAINT "unit_exam_offers_capacity_per_slot_check" CHECK (capacity_per_slot between 1 and 50)
);
--> statement-breakpoint
CREATE TABLE "unit_hours" (
	"unit_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"open_min" smallint NOT NULL,
	"close_min" smallint NOT NULL,
	CONSTRAINT "unit_hours_pkey" PRIMARY KEY("unit_id","weekday"),
	CONSTRAINT "unit_hours_weekday_check" CHECK (weekday between 0 and 6),
	CONSTRAINT "unit_hours_period_check" CHECK (0 <= open_min and open_min < close_min and close_min <= 1440)
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" "citext" NOT NULL,
	"address" text NOT NULL,
	"phone" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "units_name_key" UNIQUE("name"),
	CONSTRAINT "units_name_check" CHECK (char_length(name) between 2 and 80),
	CONSTRAINT "units_address_check" CHECK (char_length(address) between 5 and 200),
	CONSTRAINT "units_phone_check" CHECK (phone ~ '^\+[1-9][0-9]{9,14}$')
);
--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_exam_offers" ADD CONSTRAINT "unit_exam_offers_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_exam_offers" ADD CONSTRAINT "unit_exam_offers_exam_type_id_fkey" FOREIGN KEY ("exam_type_id") REFERENCES "public"."exam_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_hours" ADD CONSTRAINT "unit_hours_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "unit_exam_offers_exam_type_id_idx" ON "unit_exam_offers" USING btree ("exam_type_id");--> statement-breakpoint
CREATE TRIGGER specialties_set_updated_at BEFORE UPDATE ON "specialties" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER units_set_updated_at BEFORE UPDATE ON "units" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER exam_types_set_updated_at BEFORE UPDATE ON "exam_types" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER unit_exam_offers_set_updated_at BEFORE UPDATE ON "unit_exam_offers" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER settings_set_updated_at BEFORE UPDATE ON "settings" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
INSERT INTO "settings" ("id") VALUES (true);