CREATE TABLE "doctor_schedule_days" (
	"doctor_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"is_active" boolean NOT NULL,
	CONSTRAINT "doctor_schedule_days_pkey" PRIMARY KEY("doctor_id","weekday"),
	CONSTRAINT "doctor_schedule_days_weekday_check" CHECK (weekday between 0 and 6)
);
--> statement-breakpoint
CREATE TABLE "doctor_schedule_ranges" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_min" smallint NOT NULL,
	"end_min" smallint NOT NULL,
	CONSTRAINT "doctor_schedule_ranges_period_check" CHECK (0 <= start_min and start_min < end_min and end_min <= 1440)
);
--> statement-breakpoint
ALTER TABLE "doctor_schedule_days" ADD CONSTRAINT "doctor_schedule_days_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctor_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_schedule_ranges" ADD CONSTRAINT "doctor_schedule_ranges_day_fkey" FOREIGN KEY ("doctor_id","weekday") REFERENCES "public"."doctor_schedule_days"("doctor_id","weekday") ON DELETE cascade ON UPDATE no action;