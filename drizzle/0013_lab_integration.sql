CREATE TABLE "exam_result_versions" (
	"result_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "exam_result_versions_pkey" PRIMARY KEY("result_id","version"),
	CONSTRAINT "exam_result_versions_version_check" CHECK (version >= 1),
	CONSTRAINT "exam_result_versions_status_check" CHECK (status in ('final', 'amended')),
	CONSTRAINT "exam_result_versions_payload_check" CHECK (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 65536)
);
--> statement-breakpoint
CREATE TABLE "exam_results" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"booking_id" uuid NOT NULL,
	"booking_kind" text DEFAULT 'exam' NOT NULL,
	"client_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_results_booking_id_key" UNIQUE("booking_id"),
	CONSTRAINT "exam_results_client_external_id_key" UNIQUE("client_id","external_id"),
	CONSTRAINT "exam_results_booking_kind_check" CHECK (booking_kind = 'exam'),
	CONSTRAINT "exam_results_external_id_check" CHECK (char_length(external_id) between 1 and 64)
);
--> statement-breakpoint
CREATE TABLE "integration_clients" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" "citext" NOT NULL,
	"key_prefix" text NOT NULL,
	"api_key_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_clients_name_key" UNIQUE("name"),
	CONSTRAINT "integration_clients_key_prefix_key" UNIQUE("key_prefix"),
	CONSTRAINT "integration_clients_api_key_hash_key" UNIQUE("api_key_hash"),
	CONSTRAINT "integration_clients_name_check" CHECK (char_length(name) between 2 and 80),
	CONSTRAINT "integration_clients_key_prefix_check" CHECK (key_prefix ~ '^[a-z0-9]{8}$'),
	CONSTRAINT "integration_clients_api_key_hash_check" CHECK (api_key_hash ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "exam_result_versions" ADD CONSTRAINT "exam_result_versions_result_id_fkey" FOREIGN KEY ("result_id") REFERENCES "public"."exam_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_results" ADD CONSTRAINT "exam_results_booking_kind_fkey" FOREIGN KEY ("booking_id","booking_kind") REFERENCES "public"."bookings"("id","kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_results" ADD CONSTRAINT "exam_results_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."integration_clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_clients" ADD CONSTRAINT "integration_clients_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;