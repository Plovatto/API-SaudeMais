CREATE TABLE "doctor_time_off" (
	"doctor_id" uuid NOT NULL,
	"date" date NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_time_off_pkey" PRIMARY KEY("doctor_id","date"),
	CONSTRAINT "doctor_time_off_reason_check" CHECK (char_length(reason) between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "doctor_profiles" ADD COLUMN "appointment_duration_min" smallint;--> statement-breakpoint
ALTER TABLE "doctor_time_off" ADD CONSTRAINT "doctor_time_off_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctor_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_profiles" ADD CONSTRAINT "doctor_profiles_appointment_duration_min_check" CHECK (appointment_duration_min in (15, 20, 30, 45, 60));