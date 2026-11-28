ALTER TABLE "settings" ADD COLUMN "reminder_lead_hours" smallint DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "auto_complete_after_hours" smallint DEFAULT 72 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "notification_retention_days" smallint DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "audit_retention_days" smallint DEFAULT 180 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_reminder_lead_hours_check" CHECK (reminder_lead_hours between 1 and 168);--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_auto_complete_after_hours_check" CHECK (auto_complete_after_hours between 1 and 720);--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_notification_retention_days_check" CHECK (notification_retention_days between 7 and 730);--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_audit_retention_days_check" CHECK (audit_retention_days between 30 and 1825);