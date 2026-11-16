CREATE TRIGGER exam_results_immutable BEFORE UPDATE ON "exam_results" FOR EACH ROW EXECUTE FUNCTION reject_update();
