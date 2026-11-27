CREATE INDEX "audit_logs_actor_id_id_idx" ON "audit_logs" USING btree ("actor_id","id" DESC NULLS LAST) WHERE actor_id is not null;--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_action_id_idx" ON "audit_logs" USING btree ("action","id" DESC NULLS LAST);