CREATE TABLE "health_metrics" (
	"booking_id" uuid PRIMARY KEY NOT NULL,
	"booking_kind" text DEFAULT 'appointment' NOT NULL,
	"systolic" smallint,
	"diastolic" smallint,
	"weight_kg" numeric(5, 2),
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "health_metrics_booking_kind_check" CHECK (booking_kind = 'appointment'),
	CONSTRAINT "health_metrics_pressure_pair_check" CHECK ((systolic is null) = (diastolic is null)),
	CONSTRAINT "health_metrics_systolic_check" CHECK (systolic between 50 and 300),
	CONSTRAINT "health_metrics_diastolic_check" CHECK (diastolic between 30 and 200),
	CONSTRAINT "health_metrics_pressure_order_check" CHECK (systolic > diastolic),
	CONSTRAINT "health_metrics_weight_kg_check" CHECK (weight_kg between 1 and 500),
	CONSTRAINT "health_metrics_present_check" CHECK (systolic is not null or weight_kg is not null)
);
--> statement-breakpoint
ALTER TABLE "health_metrics" ADD CONSTRAINT "health_metrics_booking_kind_fkey" FOREIGN KEY ("booking_id","booking_kind") REFERENCES "public"."bookings"("id","kind") ON DELETE restrict ON UPDATE no action;