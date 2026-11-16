CREATE FUNCTION reject_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END
$$;--> statement-breakpoint
CREATE TRIGGER exam_result_versions_immutable BEFORE UPDATE ON "exam_result_versions" FOR EACH ROW EXECUTE FUNCTION reject_update();
