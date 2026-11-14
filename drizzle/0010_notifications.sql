CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"audience_role" text NOT NULL,
	"type" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"booking_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_audience_role_check" CHECK (audience_role in ('patient', 'doctor', 'admin')),
	CONSTRAINT "notifications_type_check" CHECK (type in ('appointment_requested', 'appointment_rescheduled', 'appointment_cancelled_by_patient', 'appointment_confirmed', 'appointment_cancelled', 'appointment_expired', 'exam_result_available', 'user_registered')),
	CONSTRAINT "notifications_params_check" CHECK (jsonb_typeof(params) = 'object' and octet_length(params::text) <= 1024),
	CONSTRAINT "notifications_booking_check" CHECK ((booking_id is null) = (type = 'user_registered'))
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_user_role_created_at_idx" ON "notifications" USING btree ("user_id","audience_role","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_user_role_unread_idx" ON "notifications" USING btree ("user_id","audience_role") WHERE read_at is null;