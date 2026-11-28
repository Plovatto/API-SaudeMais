CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"audience_roles" text[] NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcements_title_check" CHECK (char_length(title) between 1 and 80 and title ~ '\S'),
	CONSTRAINT "announcements_body_check" CHECK (char_length(body) between 1 and 500 and body ~ '\S'),
	CONSTRAINT "announcements_severity_check" CHECK (severity in ('info', 'warning', 'critical')),
	CONSTRAINT "announcements_ends_at_check" CHECK (ends_at is null or ends_at > starts_at),
	CONSTRAINT "announcements_audience_roles_check" CHECK (cardinality(audience_roles) >= 1 and audience_roles <@ array['patient', 'doctor', 'admin']::text[])
);
--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcements_active_idx" ON "announcements" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE TRIGGER announcements_set_updated_at BEFORE UPDATE ON "announcements" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
