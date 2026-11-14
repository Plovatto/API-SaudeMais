CREATE TABLE "booking_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"booking_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" uuid,
	"from_status" text,
	"to_status" text NOT NULL,
	"from_starts_at" timestamp with time zone,
	"to_starts_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_events_event_type_check" CHECK (event_type in ('created', 'rescheduled', 'confirmed', 'cancelled', 'completed', 'no_show', 'expired', 'result_received')),
	CONSTRAINT "booking_events_actor_type_check" CHECK (actor_type in ('patient', 'doctor', 'admin', 'system', 'integration')),
	CONSTRAINT "booking_events_from_status_check" CHECK (from_status in ('pending', 'confirmed', 'cancelled', 'completed', 'no_show', 'expired')),
	CONSTRAINT "booking_events_to_status_check" CHECK (to_status in ('pending', 'confirmed', 'cancelled', 'completed', 'no_show', 'expired')),
	CONSTRAINT "booking_events_actor_check" CHECK ((actor_user_id is null) = (actor_type in ('system', 'integration'))),
	CONSTRAINT "booking_events_reschedule_check" CHECK ((event_type = 'rescheduled') = (from_starts_at is not null) and (event_type = 'rescheduled') = (to_starts_at is not null))
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"patient_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"notes" text,
	"reschedule_count" smallint DEFAULT 0 NOT NULL,
	"late_cancellation" boolean DEFAULT false NOT NULL,
	"cancel_reason" text,
	"cancelled_by_role" text,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"doctor_id" uuid,
	"specialty_id" uuid,
	"visit_type" text,
	"exam_type_id" uuid,
	"public_code" text,
	"lane" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_public_code_key" UNIQUE("public_code"),
	CONSTRAINT "bookings_id_kind_key" UNIQUE("id","kind"),
	CONSTRAINT "bookings_kind_check" CHECK (kind in ('appointment', 'exam')),
	CONSTRAINT "bookings_status_check" CHECK (status in ('pending', 'confirmed', 'cancelled', 'completed', 'no_show', 'expired')),
	CONSTRAINT "bookings_visit_type_check" CHECK (visit_type in ('first_visit', 'routine', 'follow_up', 'exam_review')),
	CONSTRAINT "bookings_cancelled_by_role_check" CHECK (cancelled_by_role in ('patient', 'doctor', 'admin', 'system')),
	CONSTRAINT "bookings_notes_check" CHECK (char_length(notes) <= 500),
	CONSTRAINT "bookings_cancel_reason_check" CHECK (char_length(cancel_reason) <= 500),
	CONSTRAINT "bookings_reschedule_count_check" CHECK (reschedule_count between 0 and 10),
	CONSTRAINT "bookings_public_code_check" CHECK (public_code ~ '^EX-[0-9A-HJKMNP-TV-Z]{6}$'),
	CONSTRAINT "bookings_lane_check" CHECK (lane between 1 and 50),
	CONSTRAINT "bookings_period_check" CHECK (ends_at > starts_at and ends_at - starts_at <= interval '4 hours'),
	CONSTRAINT "bookings_kind_columns_check" CHECK ((kind = 'appointment' and doctor_id is not null and specialty_id is not null and visit_type is not null and exam_type_id is null and public_code is null and lane is null) or (kind = 'exam' and doctor_id is null and specialty_id is null and visit_type is null and exam_type_id is not null and public_code is not null and lane is not null and status in ('confirmed', 'cancelled', 'completed'))),
	CONSTRAINT "bookings_cancellation_check" CHECK ((status = 'cancelled') = (cancelled_at is not null and cancelled_by_role is not null) and (cancelled_at is null) = (cancelled_by_role is null) and (status = 'cancelled' or (not late_cancellation and cancel_reason is null)) and (cancelled_by is null) = (cancelled_by_role is null or cancelled_by_role = 'system') and (cancelled_by_role is distinct from 'doctor' or cancel_reason is not null)),
	CONSTRAINT "bookings_not_self_check" CHECK (doctor_id <> patient_id)
);
--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctor_profiles"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_specialty_id_fkey" FOREIGN KEY ("specialty_id") REFERENCES "public"."specialties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_exam_offer_fkey" FOREIGN KEY ("unit_id","exam_type_id") REFERENCES "public"."unit_exam_offers"("unit_id","exam_type_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_events_booking_id_created_at_idx" ON "booking_events" USING btree ("booking_id","created_at");--> statement-breakpoint
CREATE INDEX "bookings_patient_id_starts_at_idx" ON "bookings" USING btree ("patient_id","starts_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bookings_doctor_id_starts_at_idx" ON "bookings" USING btree ("doctor_id","starts_at") WHERE kind = 'appointment';--> statement-breakpoint
CREATE INDEX "bookings_starts_at_idx" ON "bookings" USING btree ("starts_at");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TRIGGER bookings_set_updated_at BEFORE UPDATE ON "bookings" FOR EACH ROW EXECUTE FUNCTION set_updated_at();