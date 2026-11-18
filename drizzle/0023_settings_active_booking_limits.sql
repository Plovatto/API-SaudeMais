ALTER TABLE "settings" ADD COLUMN "max_active_bookings" smallint DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "max_active_appointments" smallint DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "max_active_exams" smallint DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_max_active_bookings_check" CHECK (max_active_bookings between 1 and 50);--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_max_active_appointments_check" CHECK (max_active_appointments between 1 and 50);--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_max_active_exams_check" CHECK (max_active_exams between 1 and 50);