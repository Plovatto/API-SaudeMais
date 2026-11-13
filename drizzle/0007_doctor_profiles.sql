CREATE TABLE "doctor_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"specialty_id" uuid NOT NULL,
	"council" text NOT NULL,
	"unit_id" uuid NOT NULL,
	"registry_number" text NOT NULL,
	"registry_uf" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_profiles_registry_key" UNIQUE("council","registry_uf","registry_number"),
	CONSTRAINT "doctor_profiles_registry_number_check" CHECK (registry_number ~ '^[1-9][0-9]{0,9}$'),
	CONSTRAINT "doctor_profiles_registry_uf_check" CHECK (registry_uf ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
ALTER TABLE "doctor_profiles" ADD CONSTRAINT "doctor_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_profiles" ADD CONSTRAINT "doctor_profiles_specialty_council_fkey" FOREIGN KEY ("specialty_id","council") REFERENCES "public"."specialties"("id","council") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_profiles" ADD CONSTRAINT "doctor_profiles_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doctor_profiles_specialty_id_idx" ON "doctor_profiles" USING btree ("specialty_id");--> statement-breakpoint
CREATE INDEX "doctor_profiles_unit_id_idx" ON "doctor_profiles" USING btree ("unit_id");--> statement-breakpoint
CREATE TRIGGER doctor_profiles_set_updated_at BEFORE UPDATE ON "doctor_profiles" FOR EACH ROW EXECUTE FUNCTION set_updated_at();