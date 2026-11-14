ALTER TABLE "doctor_schedule_ranges" ADD CONSTRAINT "doctor_schedule_ranges_no_overlap_excl" EXCLUDE USING gist ("doctor_id" WITH =, "weekday" WITH =, int4range("start_min", "end_min") WITH &&);
