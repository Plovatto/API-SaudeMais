ALTER TABLE "users" ADD COLUMN "birth_date" date;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_birth_date_check" CHECK (birth_date >= '1900-01-01');