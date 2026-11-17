CREATE TABLE "email_preferences" (
	"user_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_preferences_pkey" PRIMARY KEY("user_id","topic"),
	CONSTRAINT "email_preferences_topic_check" CHECK (topic in ('booking_reminder', 'booking_decision', 'exam_result', 'appointment_request', 'appointment_cancellation', 'user_registration'))
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_preferences" ADD CONSTRAINT "email_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TRIGGER email_preferences_set_updated_at BEFORE UPDATE ON "email_preferences" FOR EACH ROW EXECUTE FUNCTION set_updated_at();